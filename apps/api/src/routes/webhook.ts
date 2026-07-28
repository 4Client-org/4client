import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { generateFormLinkUrl, buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../lib/formLink.js';
import { storeMedia, detectImageMime } from '../lib/media.js';

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { phone_number_id: string; display_phone_number: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; mime_type?: string; caption?: string; sha256?: string };
        }>;
        // Delivery/read receipts for OUTBOUND messages we sent, keyed by the same
        // `id` Meta gave that message when we sent it (stored as wpp_message_id).
        // `errors` is only present when status === 'failed' (invalid number, phone
        // blocked the business, not on WhatsApp, etc).
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

function verifyHmac(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function ingestMessage(
  fastify: FastifyInstance,
  phoneNumberId: string,
  phone: string,
  name: string,
  text: string | null,
  waMsgId: string,
  sentAt: Date,
  // Set only for an inbound photo - `media.url` is OUR OWN opaque storage token
  // (see lib/media.ts), never Meta's own short-lived media URL, so it stays
  // resolvable whenever staff actually open the chat, not just for the ~5 minutes
  // Meta's URL would have lived.
  media?: { url: string; type: 'image' },
) {
  // Find org by phone_number_id
  const org = await fastify.prisma.organization.findFirst({
    where: { wpp_meta_phone_id: phoneNumberId, active: true },
  });
  if (!org) {
    fastify.log.warn({ phoneNumberId }, 'WPP: no org for phone_number_id');
    return;
  }

  // Deduplication: skip if already ingested
  const dup = await fastify.prisma.ticketMessage.findUnique({
    where: { wpp_message_id: waMsgId },
  });
  if (dup) return;

  // Use Colombia local date (UTC-5) derived from the message timestamp
  // so the ticket fecha matches what the frontend shows as "today"
  const localMs = sentAt.getTime() + (-5 * 60 * 60 * 1000);
  const localDateStr = new Date(localMs).toISOString().split('T')[0];
  const todayLocal = new Date(localDateStr);

  // Real Bogota (UTC-5, no DST) calendar-day boundaries, in actual UTC instants - used
  // to find how many INBOUND messages this ticket already got today, so the welcome
  // message can fire once per day rather than only using `todayLocal` (a date-only
  // value with no time-of-day meaning, fine for ticket.fecha but not for a sent_at
  // range query).
  const [y, m, d] = localDateStr.split('-').map(Number);
  const dayStartUtc = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  // One ticket per (org, phone), forever - not per day. A customer who wrote a month
  // ago and writes again today continues the exact same ticket; there's no other
  // ticket for this phone this could possibly collide with (enforced by the
  // @@unique([org_id, phone]) constraint), so this is just find-or-create.
  let ticket = await fastify.prisma.ticket.findFirst({
    where: { org_id: org.id, phone },
  });

  // Gates the welcome auto-reply - must be "first message TODAY", not "first message
  // this ticket ever had". A ticket is now permanent per phone (one row forever, see
  // schema.prisma), so gating on "is this ticket brand new" alone meant a returning
  // customer who wrote last month would never get the welcome message again.
  let isFirstMessageToday: boolean;

  if (!ticket) {
    isFirstMessageToday = true;
    ticket = await fastify.prisma.ticket.create({
      data: {
        org_id: org.id,
        phone,
        customer_name: name,
        fecha: todayLocal,
        last_message_at: sentAt,
        unread_count: 1,
      },
    });
  } else {
    const priorInboundToday = await fastify.prisma.ticketMessage.count({
      where: { ticket_id: ticket.id, direction: 'in', sent_at: { gte: dayStartUtc, lt: dayEndUtc } },
    });
    isFirstMessageToday = priorInboundToday === 0;

    // Roll it forward to today (and drop any stale "queued for a specific day" flag)
    // so the board/informe pick it up wherever the conversation actually is now.
    ticket = await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        fecha: todayLocal,
        deferred_to: null,
        unread_count: { increment: 1 },
        last_message_at: sentAt,
        customer_name: name,
      },
    });
  }

  const message = await fastify.prisma.ticketMessage.create({
    data: {
      ticket_id: ticket.id,
      direction: 'in',
      text,
      media_url: media?.url ?? null,
      media_type: media?.type ?? null,
      wpp_message_id: waMsgId,
      sent_at: sentAt,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  const newUnread = (ticket.unread_count ?? 0) + 1;

  // Auto-reply welcome message on first message of the day, immediately followed by
  // the form-link message - the two used to be separate actions (welcome automatic,
  // form link a manual "Formulario" button click) but a customer's very first
  // contact now gets both without staff having to do anything.
  //
  // Fire-and-forget relative to THIS webhook handler (not awaited below - Meta
  // expects a fast 200 OK, not one held open behind 4 sequential message sends),
  // but everything INSIDE this one async IIFE is now strictly sequential: welcome
  // fully sent+recorded before the form-link sequence even starts. Previously the
  // welcome send and the form-link sequence were two INDEPENDENT `.then()` chains
  // started back to back - both real network calls to Meta with unpredictable
  // latency, so which one actually landed on the client's phone first was a race,
  // not the intended bienvenida -> aviso -> link -> seguimiento order. A failed
  // welcome send still lets the form-link sequence run (own try/catch) - the more
  // useful of the two shouldn't be skipped just because the greeting didn't land.
  if (isFirstMessageToday && org.welcome_message) {
    const provider = MetaCloudProvider.fromOrg(org);
    if (provider) {
      (async () => {
        type MediaType = 'pdf' | 'image' | 'audio' | 'video';
        try {
          const { messageId } = await provider.sendText(phone, org.welcome_message!);
          const autoReply = await fastify.prisma.ticketMessage.create({
            data: {
              ticket_id: ticket.id,
              direction: 'out',
              text: org.welcome_message!,
              wpp_message_id: messageId,
              sent_at: new Date(),
            },
          });
          fastify.io.to(`org:${org.id}`).emit('ticket:message', {
            ticketId: ticket.id,
            message: { ...autoReply, direction: 'out' as const, media_type: null as MediaType | null, sent_at: autoReply.sent_at.toISOString(), sent_by_name: null },
          });
        } catch (err) {
          fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando auto-respuesta');
          // Same reasoning as inbox.ts's /reply and public.ts's confirmations - a
          // failed send (e.g. no active 24h WhatsApp session and no approved template)
          // must leave a visible red-X message, not just a server log nobody sees.
          const failedAutoReply = await fastify.prisma.ticketMessage.create({
            data: {
              ticket_id: ticket.id, direction: 'out', text: org.welcome_message!,
              sent_at: new Date(), failed_reason: String((err as any)?.message ?? 'Error desconocido Meta API').slice(0, 255),
            },
          });
          fastify.io.to(`org:${org.id}`).emit('ticket:message', {
            ticketId: ticket.id,
            message: { ...failedAutoReply, direction: 'out' as const, media_type: null as MediaType | null, sent_at: failedAutoReply.sent_at.toISOString(), sent_by_name: null },
          });
        }

        // No sentByUserId - this is an automated send, not a staff click. public.ts's
        // /submit already falls back to the first active admin/encargado when
        // attributing an order to a token with no sentByUserId, so an order placed
        // through this auto-sent link still gets a real name in "registered_by".
        try {
          const url = await generateFormLinkUrl(fastify, ticket.id, org.id);
          // Three separate WhatsApp messages, sent in order, not one combined block -
          // the notice+bank-account text alone is already long, and appending the
          // link to it produced a single message long enough to risk mangling on
          // some phones/keyboards; splitting also lets the client forward/copy just
          // the link without dragging the notice along.
          const sendAndRecord = async (text: string) => {
            const sent = await provider.sendText(phone, text);
            const msg = await fastify.prisma.ticketMessage.create({
              data: { ticket_id: ticket.id, direction: 'out', text, wpp_message_id: sent.messageId, sent_at: new Date() },
            });
            fastify.io.to(`org:${org.id}`).emit('ticket:message', {
              ticketId: ticket.id,
              message: { ...msg, direction: 'out' as const, media_type: null as MediaType | null, sent_at: msg.sent_at.toISOString(), sent_by_name: null },
            });
          };
          await sendAndRecord(buildFormLinkWarningMessage());
          await sendAndRecord(url);
          await sendAndRecord(buildFormLinkFollowUpMessage());
        } catch (err) {
          fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando formulario automático');
          // url generation itself could theoretically throw (DB write failure) before
          // there's any text to record - still worth a visible failure marker with
          // whatever context is available, same red-X pattern as every other send.
          const failedFormLink = await fastify.prisma.ticketMessage.create({
            data: {
              ticket_id: ticket.id, direction: 'out', text: 'Formulario de pedido',
              sent_at: new Date(), failed_reason: String((err as any)?.message ?? 'Error desconocido Meta API').slice(0, 255),
            },
          });
          fastify.io.to(`org:${org.id}`).emit('ticket:message', {
            ticketId: ticket.id,
            message: { ...failedFormLink, direction: 'out' as const, media_type: null as MediaType | null, sent_at: failedFormLink.sent_at.toISOString(), sent_by_name: null },
          });
        }
      })();
    }
  }
  type MediaType = 'pdf' | 'image' | 'audio' | 'video';
  const socketMsg = {
    ...message,
    direction: message.direction as 'in' | 'out',
    media_type: message.media_type as MediaType | null,
    sent_at: message.sent_at.toISOString(),
    sent_by_name: message.sender?.name ?? null,
  };
  fastify.io.to(`org:${org.id}`).emit('ticket:message', { ticketId: ticket.id, message: socketMsg });
  fastify.io.to(`org:${org.id}`).emit('ticket:unread', { ticketId: ticket.id, count: newUnread });
  fastify.log.info({ phone, ticketId: ticket.id }, 'WPP: mensaje entrante ingresado');
}

// A photo the customer sent - Meta's webhook only gives us a media id (no
// downloadable URL), so this does the two-step resolve-then-download against the
// Graph API (see MetaCloudProvider.getMediaUrl/downloadMedia) before handing off to
// ingestMessage with the resulting bytes already stored in OUR OWN storage (never
// a public URL, and not tied to the ~5min Meta media URL's own lifetime).
async function ingestImageMessage(
  fastify: FastifyInstance,
  phoneNumberId: string,
  phone: string,
  name: string,
  image: { id: string; caption?: string },
  waMsgId: string,
  sentAt: Date,
) {
  const org = await fastify.prisma.organization.findFirst({
    where: { wpp_meta_phone_id: phoneNumberId, active: true },
  });
  if (!org) {
    fastify.log.warn({ phoneNumberId }, 'WPP: no org for phone_number_id (imagen)');
    return;
  }
  const provider = MetaCloudProvider.fromOrg(org);
  if (!provider) {
    fastify.log.warn({ orgId: org.id }, 'WPP: imagen entrante descartada - org sin credenciales Meta');
    return;
  }

  try {
    const { url, mimeType } = await provider.getMediaUrl(image.id);
    const buffer = await provider.downloadMedia(url);
    // Meta's own mime_type is still just a label, not a fact about the downloaded
    // bytes - checking the real file signature before ever storing/serving this
    // is the same defense-in-depth the outbound upload path has (inbox.ts's
    // send-image), applied to content coming FROM WhatsApp instead of TO it.
    const realMime = detectImageMime(buffer);
    if (!realMime) throw new Error(`downloaded media does not look like a real image (Meta reported ${mimeType})`);
    const token = await storeMedia(buffer, realMime);
    await ingestMessage(
      fastify, phoneNumberId, phone, name,
      image.caption ? String(image.caption).slice(0, 4096) : null,
      waMsgId, sentAt, { url: token, type: 'image' },
    );
  } catch (err) {
    fastify.log.error({ err, phone }, 'WPP: error descargando imagen entrante');
    // Still record SOMETHING - without this, a download failure (Meta API hiccup,
    // the ~5min media URL expiring before we got to it, etc.) meant the customer's
    // photo vanished with nothing but a server log line: no message in the chat at
    // all, no way for staff to even know one was sent. Every OUTBOUND failure
    // already leaves a visible red-X via failed_reason - this is the inbound
    // equivalent, using the same wpp_message_id so a Meta webhook retry for this
    // same photo still only ever produces one row (ingestMessage's own dedup).
    await ingestMessage(
      fastify, phoneNumberId, phone, name,
      'El cliente envió una foto, pero no se pudo descargar. Pídele que la reenvíe.',
      waMsgId, sentAt,
    ).catch(err2 => fastify.log.error({ err: err2, phone }, 'WPP: error registrando fallback de imagen'));
  }
}

// Updates delivered/read_by_client/failed_reason on an OUTBOUND message we already
// sent, matched by wpp_message_id - a status can arrive well after the message was
// created (Meta doesn't know delivery/read timing in advance), so this is always a
// separate event from ingestMessage above, never inline with sending.
async function ingestStatus(
  fastify: FastifyInstance,
  waMsgId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  errors: Array<{ code?: number; title?: string; message?: string }> | undefined,
) {
  const message = await fastify.prisma.ticketMessage.findUnique({
    where: { wpp_message_id: waMsgId },
    select: { id: true, ticket_id: true, ticket: { select: { org_id: true } } },
  });
  // Not every status update corresponds to a message we actually stored (e.g. one
  // for the auto-reply welcome message sent before this feature existed) - nothing
  // to update, safe to just skip.
  if (!message) return;

  // Never regresses - 'read' implies 'delivered' already happened even if that
  // specific status update got lost/arrived out of order, and once true these only
  // ever stay true (Meta doesn't un-deliver or un-read a message).
  const data: { delivered?: boolean; read_by_client?: boolean; failed_reason?: string } = {};
  if (status === 'delivered' || status === 'read') data.delivered = true;
  if (status === 'read') data.read_by_client = true;
  if (status === 'failed') {
    const first = errors?.[0];
    data.failed_reason = (first?.title ?? first?.message ?? 'Error desconocido').slice(0, 255);
  }
  if (Object.keys(data).length === 0) return; // 'sent' alone - nothing new to record

  // Read back the actual row instead of trusting just this call's own partial
  // `data` - a later 'failed' event (network issue after an earlier successful
  // delivery, rare but real) must not make the emitted payload look like it
  // regressed delivered/read_by_client back to false for clients already showing them true.
  const updated = await fastify.prisma.ticketMessage.update({
    where: { id: message.id },
    data,
    select: { delivered: true, read_by_client: true, failed_reason: true },
  });

  fastify.io.to(`org:${message.ticket.org_id}`).emit('ticket:message-status', {
    ticketId: message.ticket_id,
    messageId: message.id,
    delivered: updated.delivered,
    read_by_client: updated.read_by_client,
    failed_reason: updated.failed_reason,
  });
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  if (!config.META_APP_SECRET) {
    // RAILWAY_ENVIRONMENT_NAME, not NODE_ENV - NODE_ENV is "production" on every
    // Railway environment (build/runtime optimization flag, not environment
    // identity), so gating on it here made a dev/staging deploy with no Meta
    // credentials configured (the normal case - it has no real WhatsApp number)
    // crash-loop forever instead of just warning, exactly like a genuine prod
    // misconfiguration would. Only the actual "production" environment enforces this.
    if (config.RAILWAY_ENVIRONMENT_NAME === 'production') {
      // Fail closed: without HMAC verification the webhook would accept forged messages.
      throw new Error('META_APP_SECRET es obligatorio en producción - configúralo antes de desplegar');
    }
    fastify.log.warn('⚠️  META_APP_SECRET no configurado - webhook acepta solicitudes sin verificar firma HMAC (solo permitido fuera de producción)');
  }
  // Capture raw body for HMAC validation before JSON parsing
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      const parsed = JSON.parse((body as Buffer).toString());
      (_req as FastifyRequest & { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  });

  // GET - Meta webhook verification handshake
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.META_WEBHOOK_VERIFY_TOKEN) {
      fastify.log.info('WPP webhook verificado por Meta');
      return reply.status(200).send(q['hub.challenge']);
    }
    return reply.status(403).send({ error: 'Token inválido' });
  });

  // POST - incoming messages from Meta
  fastify.post('/', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // HMAC-SHA256 signature validation - mandatory when META_APP_SECRET is set
    const signature = (req.headers['x-hub-signature-256'] as string) ?? '';
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;

    if (config.META_APP_SECRET) {
      if (!rawBody || !signature) {
        fastify.log.warn('WPP: request sin firma X-Hub-Signature-256');
        return reply.status(403).send({ error: 'Firma requerida', code: 'MISSING_SIGNATURE' });
      }
      if (!verifyHmac(rawBody, signature, config.META_APP_SECRET)) {
        fastify.log.warn('WPP: firma HMAC inválida');
        return reply.status(403).send({ error: 'Firma inválida', code: 'INVALID_SIGNATURE' });
      }
    }

    const payload = req.body as MetaWebhookPayload;

    // Always return 200 fast - Meta retries if we're slow or error
    reply.status(200).send({ ok: true });

    if (payload?.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const { metadata, contacts, messages, statuses } = change.value;

        for (const msg of messages ?? []) {
          if (msg.type !== 'text' && msg.type !== 'image') continue;

          const sentAt = new Date(parseInt(msg.timestamp) * 1000);
          // Reject replayed messages older than 10 minutes
          if (Date.now() - sentAt.getTime() > 10 * 60 * 1000) continue;

          const phone = String(msg.from ?? '').slice(0, 20);
          const name  = String(contacts?.find(c => c.wa_id === msg.from)?.profile.name ?? msg.from ?? '').slice(0, 200);

          if (msg.type === 'image' && msg.image?.id) {
            ingestImageMessage(fastify, metadata.phone_number_id, phone, name, msg.image, msg.id, sentAt)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo imagen'));
            continue;
          }

          if (!msg.text?.body) continue;
          const text = String(msg.text.body).slice(0, 4096);
          ingestMessage(fastify, metadata.phone_number_id, phone, name, text, msg.id, sentAt)
            .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo mensaje'));
        }

        // Delivery/read/failure receipts arrive as their own webhook events
        // (Meta doesn't send `messages` and `statuses` together in practice), so
        // this must never be gated on `messages` being present.
        for (const s of statuses ?? []) {
          ingestStatus(fastify, s.id, s.status, s.errors)
            .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo status'));
        }
      }
    }
  });
}
