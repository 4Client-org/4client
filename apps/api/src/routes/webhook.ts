import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { generateFormLinkUrl, buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../lib/formLink.js';
import {
  storeMedia, detectImageMime, detectMediaMime,
  isSupportedAudioMime, isSupportedVideoMime, isSupportedDocumentMime,
} from '../lib/media.js';

// Shared across every place a stored TicketMessage's media kind needs naming.
type MediaType = 'image' | 'audio' | 'video' | 'document' | 'location';

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { phone_number_id: string; display_phone_number: string };
        // wa_id/user_id both optional - Meta's WhatsApp usernames rollout
        // (BSUID, June 2026) means a contact can arrive with only ONE of
        // them, never both missing at once for a real message. `username`
        // (nested under profile, alongside the display name) is the actual
        // @handle for a BSUID-identified user - `name` alone for these tends
        // to be short/decorative (emoji, punctuation) and not very useful on
        // its own.
        contacts?: Array<{ profile: { name: string; username?: string }; wa_id?: string; user_id?: string }>;
        messages?: Array<{
          // Real phone number - omitted when the sender has WhatsApp
          // usernames enabled and from_user_id is present instead (see
          // MetaWebhookPayload's own note above).
          from?: string;
          // BSUID form of the sender - the only identifier present for a
          // username-enabled contact once `from` is omitted. Format
          // "CC.<up to 128 alphanumeric chars>" (e.g. "CO.919210307886008") -
          // meta-cloud.ts sends to this the same way as a phone number, just
          // via Meta's `recipient` field instead of `to`.
          from_user_id?: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; mime_type?: string; caption?: string; sha256?: string };
          audio?: { id: string; mime_type?: string };
          video?: { id: string; mime_type?: string; caption?: string };
          document?: { id: string; mime_type?: string; caption?: string; filename?: string };
          location?: { latitude: number; longitude: number; name?: string; address?: string };
          // A sticker is just a webp image with its own Meta media id - same
          // resolve-then-download path as a photo (image/webp is already a
          // supported image mime, see lib/media.ts's MIME_EXT), just no caption.
          sticker?: { id: string; mime_type?: string; animated?: boolean };
          // Customer reacting with an emoji to one of our (or their own) messages.
          // Field names per Meta's documented shape - UNVERIFIED against a real
          // captured payload from this org (none exists yet), so this is handled
          // defensively below: any shape mismatch falls through to the same
          // generic "[Tipo de mensaje no soportado]" placeholder already shipped,
          // never throws.
          reaction?: { message_id?: string; emoji?: string };
          // A tap on a button/list option WE sent via an interactive message.
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
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
  // Set for any inbound media - `media.url` is OUR OWN opaque storage token (see
  // lib/media.ts) for image/audio/video/document, never Meta's own short-lived
  // media URL, so it stays resolvable whenever staff actually open the chat, not
  // just for the ~5 minutes Meta's URL would have lived. For 'location' it's a
  // plain Google Maps link instead (no file to store - the coordinates arrive
  // directly in the webhook payload, nothing to download).
  media?: { url: string; type: MediaType },
  // True when `phone` is a synthesized placeholder (Meta delivered this message
  // with no real sender number) - see the dispatcher above. Marks the ticket so
  // staff see a clear warning instead of a normal-looking but silently
  // unreachable chat, and skips the auto welcome/link send below entirely
  // (every attempt would fail against Meta anyway - no point burning 3 calls
  // and 3 failed_reason rows to learn that).
  noWppNumber = false,
  // The ENTIRE webhook POST body this message arrived in, verbatim - stored on
  // both the ticket (only if this message is what creates it - see below) and
  // every inbound TicketMessage row, so there's a durable, queryable record of
  // exactly what Meta sent regardless of how short log retention turns out to
  // be. `unknown` on purpose - never parsed/typed, just persisted as-is.
  rawPayload?: unknown,
  // The contact's BSUID (user_id), when this webhook's contacts[] entry happened
  // to carry it ALONGSIDE a real wa_id/phone - see Ticket.bsuid's own comment.
  // Threaded through every ingest* helper so a later BSUID-only message from the
  // same person can still find this ticket instead of spawning a duplicate.
  bsuidHint?: string,
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
  // ago and writes again today continues the exact same ticket. Also matches on
  // `bsuid` (not just `phone`) so a person previously seen under their real phone
  // number, whose BSUID got learned and stored on that ticket (see Ticket.bsuid),
  // still resolves to the SAME ticket on a later message that arrives as
  // BSUID-only - otherwise this identity split would silently recreate the exact
  // "Vivi"/"dayis" fragmentation bug already hit once in production.
  let ticket = await fastify.prisma.ticket.findFirst({
    where: { org_id: org.id, OR: [{ phone }, { bsuid: phone }, ...(bsuidHint ? [{ bsuid: bsuidHint }] : [])] },
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
        first_message_today_at: sentAt,
        unread_count: 1,
        no_wpp_number: noWppNumber,
        raw_payload: rawPayload as any,
        bsuid: bsuidHint ?? null,
      },
    });
  } else {
    const priorInboundToday = await fastify.prisma.ticketMessage.count({
      where: { ticket_id: ticket.id, direction: 'in', sent_at: { gte: dayStartUtc, lt: dayEndUtc } },
    });
    isFirstMessageToday = priorInboundToday === 0;

    // Roll it forward to today (and drop any stale "queued for a specific day" flag)
    // so the board/informe pick it up wherever the conversation actually is now.
    // bsuid only ever gets SET here, never overwritten with null - once learned
    // for this ticket it stays, regardless of which identifier a later message uses.
    ticket = await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        fecha: todayLocal,
        deferred_to: null,
        unread_count: { increment: 1 },
        last_message_at: sentAt,
        // Fixed for the rest of the day on the FIRST inbound message only - a
        // second/third message today must never move this, or the board's
        // "first to arrive stays first" position would drift forward every
        // time this customer writes again (the exact bug being fixed here).
        ...(isFirstMessageToday ? { first_message_today_at: sentAt } : {}),
        customer_name: name,
        ...(bsuidHint && !ticket.bsuid ? { bsuid: bsuidHint } : {}),
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
      raw_payload: rawPayload as any,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  const newUnread = (ticket.unread_count ?? 0) + 1;

  // Auto-reply on first message of the day: welcome + safety notice combined into
  // ONE message, then the link alone, then the follow-up nudge - three messages
  // total, by explicit request (used to be four: welcome and the notice were two
  // separate sends). A customer's very first contact gets all of this without
  // staff having to do anything.
  //
  // Fire-and-forget relative to THIS webhook handler (not awaited below - Meta
  // expects a fast 200 OK, not one held open behind 3 sequential message sends),
  // but everything INSIDE this one async IIFE runs strictly in order.
  if (isFirstMessageToday && org.welcome_message && !noWppNumber) {
    const provider = MetaCloudProvider.fromOrg(org);
    if (provider) {
      (async () => {
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
        const recordFailed = async (text: string, err: unknown) => {
          fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando bienvenida/formulario automático');
          // Same reasoning as inbox.ts's /reply and public.ts's confirmations - a
          // failed send (e.g. no active 24h WhatsApp session) must leave a visible
          // red-X message, not just a server log nobody sees.
          const failed = await fastify.prisma.ticketMessage.create({
            data: {
              ticket_id: ticket.id, direction: 'out', text,
              sent_at: new Date(), failed_reason: String((err as any)?.message ?? 'Error desconocido Meta API').slice(0, 255),
            },
          });
          fastify.io.to(`org:${org.id}`).emit('ticket:message', {
            ticketId: ticket.id,
            message: { ...failed, direction: 'out' as const, media_type: null as MediaType | null, sent_at: failed.sent_at.toISOString(), sent_by_name: null },
          });
        };

        const welcomeAndNotice = `${org.welcome_message}\n\n${buildFormLinkWarningMessage()}`;
        try {
          await sendAndRecord(welcomeAndNotice);
        } catch (err) {
          await recordFailed(welcomeAndNotice, err);
        }

        // No sentByUserId - this is an automated send, not a staff click. public.ts's
        // /submit already falls back to the first active admin/encargado when
        // attributing an order to a token with no sentByUserId, so an order placed
        // through this auto-sent link still gets a real name in "registered_by".
        // Kept as its own try/catch, separate from the message above - a failed
        // welcome+notice send must not skip the link, the actually useful part.
        try {
          const url = await generateFormLinkUrl(fastify, ticket.id, org.id);
          await sendAndRecord(url);
          await sendAndRecord(buildFormLinkFollowUpMessage());
        } catch (err) {
          // url generation itself could theoretically throw (DB write failure) before
          // there's any text to record - still worth a visible failure marker with
          // whatever context is available, same red-X pattern as every other send.
          await recordFailed('Formulario de pedido', err);
        }
      })();
    }
  }
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
  noWppNumber = false,
  rawPayload?: unknown,
  bsuidHint?: string,
  // Only affects the failure-fallback text below ('foto' vs 'sticker') - the
  // successful path stores/renders both identically as type 'image'.
  kindLabel: 'foto' | 'sticker' = 'foto',
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
      waMsgId, sentAt, { url: token, type: 'image' }, noWppNumber, rawPayload, bsuidHint,
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
      kindLabel === 'sticker'
        ? 'El cliente envió un sticker, pero no se pudo descargar. Pídele que lo reenvíe.'
        : 'El cliente envió una foto, pero no se pudo descargar. Pídele que la reenvíe.',
      waMsgId, sentAt, undefined, noWppNumber, rawPayload, bsuidHint,
    ).catch(err2 => fastify.log.error({ err: err2, phone }, 'WPP: error registrando fallback de imagen'));
  }
}

const MEDIA_KIND_LABEL: Record<'audio' | 'video' | 'document', string> = {
  audio: 'audio', video: 'video', document: 'documento',
};
const MEDIA_KIND_VALIDATOR: Record<'audio' | 'video' | 'document', (mime: string) => boolean> = {
  audio: isSupportedAudioMime, video: isSupportedVideoMime, document: isSupportedDocumentMime,
};

// Same resolve-then-download shape as ingestImageMessage above, generalized for
// the three media kinds that all go through Meta's media-id resolution (audio,
// video, document) - only the byte-signature check (detectMediaMime vs
// detectImageMime) and the mime allow-list actually differ per kind.
async function ingestBinaryMediaMessage(
  fastify: FastifyInstance,
  phoneNumberId: string,
  phone: string,
  name: string,
  kind: 'audio' | 'video' | 'document',
  media: { id: string; caption?: string; filename?: string },
  waMsgId: string,
  sentAt: Date,
  noWppNumber = false,
  rawPayload?: unknown,
  bsuidHint?: string,
) {
  const label = MEDIA_KIND_LABEL[kind];
  const org = await fastify.prisma.organization.findFirst({
    where: { wpp_meta_phone_id: phoneNumberId, active: true },
  });
  if (!org) {
    fastify.log.warn({ phoneNumberId }, `WPP: no org for phone_number_id (${label})`);
    return;
  }
  const provider = MetaCloudProvider.fromOrg(org);
  if (!provider) {
    fastify.log.warn({ orgId: org.id }, `WPP: ${label} entrante descartado - org sin credenciales Meta`);
    return;
  }

  try {
    const { url, mimeType } = await provider.getMediaUrl(media.id);
    if (!MEDIA_KIND_VALIDATOR[kind](mimeType)) {
      throw new Error(`unsupported ${label} mime type reported by Meta: ${mimeType}`);
    }
    const buffer = await provider.downloadMedia(url);
    const realMime = detectMediaMime(buffer, mimeType);
    if (!realMime) throw new Error(`downloaded media does not look like a real ${label} (Meta reported ${mimeType})`);
    const token = await storeMedia(buffer, realMime);
    // Caption if the type carries one, else the original filename (documents) -
    // never both, and never a raw unbounded string either way.
    const text = media.caption ? String(media.caption).slice(0, 4096)
      : media.filename ? String(media.filename).slice(0, 500)
      : null;
    await ingestMessage(
      fastify, phoneNumberId, phone, name, text,
      waMsgId, sentAt, { url: token, type: kind }, noWppNumber, rawPayload, bsuidHint,
    );
  } catch (err) {
    fastify.log.error({ err, phone }, `WPP: error descargando ${label} entrante`);
    // Same reasoning as ingestImageMessage's own fallback - a download failure
    // must still leave a visible row in the chat, not just a server log line.
    await ingestMessage(
      fastify, phoneNumberId, phone, name,
      `El cliente envió un ${label}, pero no se pudo descargar. Pídele que lo reenvíe.`,
      waMsgId, sentAt, undefined, noWppNumber, rawPayload, bsuidHint,
    ).catch(err2 => fastify.log.error({ err: err2, phone }, `WPP: error registrando fallback de ${label}`));
  }
}

// Unlike every other media type, a location never goes through Meta's media-id
// resolution at all - the coordinates arrive directly in the webhook payload, so
// there's nothing to download or verify. Stored as a plain Google Maps link in
// media_url (safe to expose directly, unlike a photo - it's just numbers, not a
// file staff need auth-gated serving for) so every chat view can render/open it
// the exact same way it already renders any other media_url.
async function ingestLocationMessage(
  fastify: FastifyInstance,
  phoneNumberId: string,
  phone: string,
  name: string,
  location: { latitude: number; longitude: number; name?: string; address?: string },
  waMsgId: string,
  sentAt: Date,
  noWppNumber = false,
  rawPayload?: unknown,
  bsuidHint?: string,
) {
  const label = [location.name, location.address].filter(Boolean).join(' - ');
  const text = label ? `Ubicación: ${label}` : 'Ubicación compartida';
  const mapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
  await ingestMessage(
    fastify, phoneNumberId, phone, name, text,
    waMsgId, sentAt, { url: mapsLink, type: 'location' }, noWppNumber, rawPayload, bsuidHint,
  );
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

    // The exact JSON Meta sent, before any of our own parsing/interpretation -
    // Meta itself keeps no delivery history to look this up after the fact (not
    // even in their own dashboard), so this is the ONLY place this is ever
    // recoverable. Confirmed the hard way: a message arrived with an empty
    // sender phone number and there was nothing left to inspect afterward.
    fastify.log.info({ rawPayload: payload }, 'WPP: webhook payload recibido');

    // Always return 200 fast - Meta retries if we're slow or error
    reply.status(200).send({ ok: true });

    if (payload?.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const { metadata, contacts, messages, statuses } = change.value;

        for (const msg of messages ?? []) {
          const sentAt = new Date(parseInt(msg.timestamp) * 1000);
          // Reject replayed messages older than 10 minutes
          if (Date.now() - sentAt.getTime() > 10 * 60 * 1000) continue;

          // Real phone number first, then the BSUID (WhatsApp usernames,
          // June 2026 - see MetaWebhookPayload's own notes) as a fallback -
          // a username-enabled contact can arrive with ONLY from_user_id, no
          // phone at all. Confirmed real via raw_payload on production
          // tickets: Meta sent `from_user_id: "CO.919210307886008"` with no
          // `from` field whatsoever.
          const rawIdentifier = String(msg.from || msg.from_user_id || '').slice(0, 150);
          // Only when NEITHER is present (a separate, rarer glitch - see the
          // no_wpp_number comment on the Ticket model) is this customer
          // actually unreachable. `phone` still needs SOME unique value
          // (@@unique([org_id, phone]) on Ticket) - a random placeholder that
          // can never collide with a real number/BSUID OR a previous ghost
          // ticket, instead of leaving it '' and creating a ticket that's
          // indistinguishable from a normal, reachable one right up until
          // every reply to it fails.
          const noWppNumber = rawIdentifier.length === 0;
          const phone = noWppNumber ? `no-${crypto.randomBytes(8).toString('hex')}` : rawIdentifier;
          const contact = contacts?.find(c =>
            (msg.from && c.wa_id === msg.from) || (msg.from_user_id && c.user_id === msg.from_user_id));
          const name = String(contact?.profile.name ?? rawIdentifier ?? '').slice(0, 200);
          // Only meaningful when the SAME contact entry carries both a real wa_id
          // and a BSUID user_id - see Ticket.bsuid's own comment for why this
          // matters (prevents the same person fragmenting across two tickets).
          const bsuidHint = contact?.wa_id && contact?.user_id ? contact.user_id : undefined;

          // Handled BEFORE the generic unsupported-type fallback below, each
          // defensively: if the actual payload doesn't have the field shape we
          // expect (unverified against a real captured example - see the type
          // comments above), it falls straight through to that same generic
          // placeholder instead of guessing wrong or throwing.
          if (msg.type === 'reaction' && msg.reaction?.emoji) {
            const original = msg.reaction.message_id
              ? await fastify.prisma.ticketMessage.findUnique({
                  where: { wpp_message_id: msg.reaction.message_id },
                  select: { text: true },
                })
              : null;
            const text = original?.text
              ? `Reaccionó ${msg.reaction.emoji} a: "${original.text.slice(0, 100)}"`
              : `Reaccionó ${msg.reaction.emoji}`;
            ingestMessage(fastify, metadata.phone_number_id, phone, name, text, msg.id, sentAt, undefined, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo reacción'));
            continue;
          }

          if (msg.type === 'interactive' && (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title)) {
            const title = msg.interactive.button_reply?.title ?? msg.interactive.list_reply?.title;
            ingestMessage(fastify, metadata.phone_number_id, phone, name, `Seleccionó: ${title}`, msg.id, sentAt, undefined, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo respuesta interactiva'));
            continue;
          }

          const SUPPORTED_TYPES = ['text', 'image', 'audio', 'video', 'document', 'location', 'sticker'];
          if (!SUPPORTED_TYPES.includes(msg.type)) {
            // Previously silently dropped (`continue`, no ticket touched at all) -
            // Meta's `reaction`/`interactive`/`sticker`/etc types are real inbound
            // activity from a real customer and must leave SOME trace in the chat,
            // even without being able to render the actual content. Bumps
            // last_message_at like any other genuine inbound message (correct -
            // this is a real arrival, not a staff/order-side side effect).
            ingestMessage(
              fastify, metadata.phone_number_id, phone, name,
              `[Tipo de mensaje no soportado: ${msg.type}]`,
              msg.id, sentAt, undefined, noWppNumber, payload, bsuidHint,
            ).catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo mensaje no soportado'));
            continue;
          }

          if (msg.type === 'image' && msg.image?.id) {
            ingestImageMessage(fastify, metadata.phone_number_id, phone, name, msg.image, msg.id, sentAt, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo imagen'));
            continue;
          }

          // A sticker IS just a webp image (no caption) - same download/store/
          // display pipeline as a regular photo, only the media id's location
          // in the payload differs.
          if (msg.type === 'sticker' && msg.sticker?.id) {
            ingestImageMessage(fastify, metadata.phone_number_id, phone, name, msg.sticker, msg.id, sentAt, noWppNumber, payload, bsuidHint, 'sticker')
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo sticker'));
            continue;
          }

          if (msg.type === 'audio' && msg.audio?.id) {
            ingestBinaryMediaMessage(fastify, metadata.phone_number_id, phone, name, 'audio', msg.audio, msg.id, sentAt, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo audio'));
            continue;
          }

          if (msg.type === 'video' && msg.video?.id) {
            ingestBinaryMediaMessage(fastify, metadata.phone_number_id, phone, name, 'video', msg.video, msg.id, sentAt, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo video'));
            continue;
          }

          if (msg.type === 'document' && msg.document?.id) {
            ingestBinaryMediaMessage(fastify, metadata.phone_number_id, phone, name, 'document', msg.document, msg.id, sentAt, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo documento'));
            continue;
          }

          if (msg.type === 'location' && msg.location) {
            ingestLocationMessage(fastify, metadata.phone_number_id, phone, name, msg.location, msg.id, sentAt, noWppNumber, payload, bsuidHint)
              .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo ubicación'));
            continue;
          }

          if (!msg.text?.body) continue;
          const text = String(msg.text.body).slice(0, 4096);
          ingestMessage(fastify, metadata.phone_number_id, phone, name, text, msg.id, sentAt, undefined, noWppNumber, payload, bsuidHint)
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
