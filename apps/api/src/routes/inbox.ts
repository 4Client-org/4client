import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { generateFormLinkUrl } from '../lib/formLink.js';
import {
  isValidMetaMediaId, isSupportedImageMime, detectImageMime,
  isSupportedAudioMime, isSupportedVideoMime, isSupportedDocumentMime, detectMediaMime,
} from '../lib/media.js';
import { extractOrderItems } from '../services/ai/index.js';
import { matchProductName } from '../lib/matchProduct.js';
import { normalizeSearch } from '../lib/normalize.js';

// Meta's own outbound size limits per media type - enforced here too so an
// oversized upload fails fast with a clear message instead of getting rejected
// only after already stored in R2 and sent to Meta's media endpoint.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export default async function inboxRoutes(fastify: FastifyInstance) {
  // GET /api/v1/inbox - lista de todas las conversaciones, solo admin/dev por
  // decisión explícita (se probó abrirlo a encargado también, se revirtió a
  // propósito - el encargado ya tiene todo lo que necesita vía el tablero de
  // Tickets & Pedidos).
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ page: z.coerce.number().default(1) }).parse(req.query);

    const allTickets = await fastify.prisma.ticket.findMany({
      where: { org_id: req.user.orgId },
      include: {
        messages: { orderBy: { created_at: 'desc' }, take: 1 },
        orders: {
          where: { status: { not: 'papelera' } },
          select: { id: true, num: true, status: true, paid: true },
        },
      },
      // last_activity_at, not last_message_at - this panel wants normal WhatsApp-app
      // behavior (most recent activity in EITHER direction floats to top, so
      // replying to an old chat brings it back up). last_message_at is reserved for
      // the board's fixed arrival order - see schema.prisma's comment on both fields.
      orderBy: { last_activity_at: 'desc' },
      take: 500,
    });

    // Deduplicate by phone: keep only the most recent ticket per customer
    const seenPhones = new Set<string>();
    const tickets = allTickets.filter(t => {
      if (seenPhones.has(t.phone)) return false;
      seenPhones.add(t.phone);
      return true;
    });

    return reply.send({ data: tickets });
  });

  // GET /api/v1/inbox/search?q=TEXT&fecha=YYYY-MM-DD - busca en TODO el
  // historial (no solo los 500 tickets más recientes que GET / carga), como la
  // búsqueda real de WhatsApp: por nombre, teléfono, o contenido de cualquier
  // mensaje, opcionalmente acotado a una fecha. Devuelve TICKETS que hacen
  // match (no una lista plana de mensajes), cada uno con el mensaje que hizo
  // match como fragmento de contexto - mismo patrón visual que WhatsApp real.
  //
  // $queryRaw (primer uso en este código) porque ni un LATERAL JOIN ni
  // immutable_unaccent() son expresables con el query builder normal de
  // Prisma - sigue totalmente parametrizado (tagged template), nunca
  // concatenación de strings, cero riesgo de inyección.
  fastify.get('/search', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({
      q: z.string().trim().max(200).optional(),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'Parámetros inválidos', code: 'VALIDATION_ERROR' });

    const text = query.data.q?.trim() || null;
    const fecha = query.data.fecha;
    if (!text && !fecha) return reply.send({ data: [] });

    const likePattern = text ? `%${text}%` : null;

    // Bogota (UTC-5, sin DST) límites de día reales, en instantes UTC - mismo
    // cálculo que ya usa webhook.ts para "primer mensaje del día".
    let dayStartUtc: Date | null = null;
    let dayEndUtc: Date | null = null;
    if (fecha) {
      const [y, m, d] = fecha.split('-').map(Number);
      dayStartUtc = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
      dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
    }

    const rows = await fastify.prisma.$queryRaw<Array<{
      id: string; customer_name: string | null; phone: string; last_activity_at: Date | null;
      unread_count: number; snippet_text: string | null; snippet_at: Date | null;
    }>>`
      SELECT t.id, t.customer_name, t.phone, t.last_activity_at, t.unread_count,
        matched.text AS snippet_text, matched.sent_at AS snippet_at
      FROM "tickets" t
      LEFT JOIN LATERAL (
        SELECT m.text, m.sent_at
        FROM "ticket_messages" m
        WHERE m.ticket_id = t.id
          ${likePattern ? Prisma.sql`AND immutable_unaccent(lower(m.text)) LIKE immutable_unaccent(lower(${likePattern}))` : Prisma.empty}
          ${dayStartUtc ? Prisma.sql`AND m.sent_at >= ${dayStartUtc} AND m.sent_at < ${dayEndUtc}` : Prisma.empty}
        ORDER BY m.sent_at DESC
        LIMIT 1
      ) matched ON true
      WHERE t.org_id = ${req.user.orgId}::uuid
        AND (
          matched.text IS NOT NULL
          ${likePattern ? Prisma.sql`OR immutable_unaccent(lower(t.customer_name)) LIKE immutable_unaccent(lower(${likePattern}))` : Prisma.empty}
          ${likePattern ? Prisma.sql`OR t.phone LIKE ${likePattern}` : Prisma.empty}
        )
      ORDER BY COALESCE(matched.sent_at, t.last_activity_at) DESC NULLS LAST
      LIMIT 50
    `;

    return reply.send({
      data: rows.map((r) => ({
        id: r.id, customer_name: r.customer_name, phone: r.phone,
        last_activity_at: r.last_activity_at, unread_count: r.unread_count,
        snippet: r.snippet_text, snippet_at: r.snippet_at,
      })),
    });
  });

  // GET /api/v1/inbox/:ticketId/messages - historial completo del chat (todos los roles pueden ver)
  // Orders attached to the ticket are scoped to `fecha` when given - a chat opened
  // from a given day on the board must only show that day's pedido, not every order
  // this customer ever placed (a ticket is one row per phone forever, see schema).
  // No `fecha` (older/other callers) falls back to the previous unscoped behavior.
  fastify.get('/:ticketId/messages', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const query = z.object({ fecha: z.string().optional() }).safeParse(req.query);
    const fecha = query.success && query.data.fecha ? new Date(query.data.fecha) : undefined;

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
          take: 500,
          include: { sender: { select: { id: true, name: true } } },
        },
        orders: {
          where: fecha ? { status: { not: 'papelera' }, fecha } : { status: { not: 'papelera' } },
          include: { items: true, employee: { select: { id: true, name: true } } },
        },
      },
    });

    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    // unread_count is deliberately NOT cleared just by opening/viewing the chat
    // anymore - it only clears when staff actually sends a reply (see POST
    // /:ticketId/reply below). Opening a chat a thousand times without answering
    // must not make the "sin leer" dot disappear - that dot means "needs a reply",
    // not "someone glanced at it".
    return reply.send({ data: ticket });
  });

  // POST /api/v1/inbox/:ticketId/reply - responder desde 4Client, todos los roles
  fastify.post('/:ticketId/reply', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({ text: z.string().min(1).max(4096) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Mensaje requerido', code: 'VALIDATION_ERROR' });

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: { org: true },
    });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const message = await fastify.prisma.ticketMessage.create({
      data: {
        ticket_id: ticketId,
        direction: 'out',
        text: body.data.text,
        sent_by: req.user.userId,
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    // Do NOT update last_message_at on outgoing replies - only incoming customer messages should
    // move a ticket up in the queue, so the inbox order stays stable when agents reply.
    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });

    // The "sin leer" dot only clears when staff actually answers - not just from
    // opening the chat (see GET /:ticketId/messages above). An actual reply IS the
    // answer, so this is the one place it's safe to clear it.
    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    // Enviar via Meta Cloud API - fired in the BACKGROUND, not awaited before
    // responding. The DB row + 'ticket:message' emit above already put the
    // message on-screen (everyone's chat, including the sender's own, via the
    // same socket room) before this even starts - awaiting Meta's own round trip
    // here just held the HTTP response (and so the input clearing / button
    // re-enabling) hostage to it for no benefit, since delivery status was
    // already being reported asynchronously via 'ticket:message-status' regardless
    // (DeliveryStatus.tsx already renders a pending state until that arrives).
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    const wpp_status: 'sending' | 'no_credentials' = provider ? 'sending' : 'no_credentials';
    if (!provider) {
      fastify.log.warn({ ticketId }, 'WPP: org sin credenciales Meta, mensaje solo guardado en BD');
    } else {
      const orgId = req.user.orgId;
      provider.sendText(ticket.phone, body.data.text)
        .then(async ({ messageId }) => {
          // Capturing and storing this is the whole point - webhook.ts's ingestStatus
          // matches every later delivered/read/failed status update by THIS id
          // (wpp_message_id). Without saving it here, every status Meta ever sends for
          // this message has nothing to match against and is silently dropped -
          // DeliveryStatus.tsx stays stuck on a single gray check forever, never a
          // failure either, indistinguishable from "still sending".
          await fastify.prisma.ticketMessage.update({ where: { id: message.id }, data: { wpp_message_id: messageId } });
          fastify.io.to(`org:${orgId}`).emit('ticket:message-status', {
            ticketId, messageId: message.id, delivered: false, read_by_client: false, failed_reason: null,
          });
        })
        .catch(async (err: any) => {
          const wpp_error = err?.message ?? 'Error desconocido Meta API';
          fastify.log.error({ err, ticketId }, 'WPP: error enviando respuesta via Meta API');
          // Recorded on the message itself (not just returned in the HTTP response,
          // which is long gone by now) so DeliveryStatus shows the red "no se pudo
          // entregar" X - e.g. WhatsApp's 24h customer-service-window policy
          // rejecting a business-initiated message with no active session.
          // Broadcast so anyone else with this chat already open sees it update
          // live, same as a real Meta webhook status would.
          const failed = await fastify.prisma.ticketMessage.update({
            where: { id: message.id },
            data: { failed_reason: String(wpp_error).slice(0, 255) },
            select: { delivered: true, read_by_client: true, failed_reason: true },
          });
          fastify.io.to(`org:${orgId}`).emit('ticket:message-status', {
            ticketId, messageId: message.id, ...failed,
          });
        });
    }

    return reply.status(201).send({ data: message, wpp_status });
  });

  // POST /api/v1/inbox/messages/:messageId/forward - reenvía un mensaje existente
  // (texto o cualquier media) a uno o varios OTROS chats. La media nunca vive de
  // nuestro lado (ver lib/media.ts) - la fila nueva simplemente reutiliza el
  // mismo media_id de Meta que ya tenía el mensaje original (varias filas
  // TicketMessage pueden apuntar al mismo media_id sin problema, GET /media/:id
  // no exige un dueño único), así que VER el reenvío funciona igual que ver el
  // original. Pero un media_id de Meta NO es reutilizable para ENVIAR de nuevo -
  // hay que pedirle los bytes a Meta una sola vez (no una por destino) y volver
  // a subirlos como una copia nueva por cada chat destino.
  fastify.post('/messages/:messageId/forward', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const body = z.object({ targetTicketIds: z.array(z.string().uuid()).min(1).max(20) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Selecciona al menos un chat', code: 'VALIDATION_ERROR' });

    const source = await fastify.prisma.ticketMessage.findFirst({
      where: { id: messageId, ticket: { org_id: req.user.orgId } },
    });
    if (!source) return reply.status(404).send({ error: 'Mensaje no encontrado', code: 'NOT_FOUND' });

    // Reenviarse a sí mismo no tiene sentido - filtrado también en el frontend,
    // pero nunca confiado solo a eso.
    const targetIds = body.data.targetTicketIds.filter((id) => id !== source.ticket_id);
    if (targetIds.length === 0) {
      return reply.status(400).send({ error: 'Elige un chat distinto al actual', code: 'VALIDATION_ERROR' });
    }

    const targets = await fastify.prisma.ticket.findMany({
      where: { id: { in: targetIds }, org_id: req.user.orgId },
      include: { org: true },
    });
    const foundIds = new Set(targets.map((t) => t.id));
    const missing = targetIds.filter((id) => !foundIds.has(id));

    const isLocation = source.media_type === 'location';
    const hasUploadableMedia = !!source.media_type && !isLocation;
    // Los bytes solo se necesitan para volver a subirlos a Meta por CADA
    // destino - una sola descarga acá (no una por destino), y se descartan
    // apenas termina el for de abajo (nunca se guardan). Si Meta ya no lo
    // tiene (más de 30 días), el reenvío sigue creando la fila en cada chat
    // destino (para que quede el registro), pero no llega a enviarse por
    // WhatsApp - mismo caso que "org sin credenciales", visto más abajo.
    let buffer: Buffer | null = null;
    let mimeType: string | null = null;
    if (hasUploadableMedia && source.media_url) {
      const org = await fastify.prisma.organization.findUnique({ where: { id: req.user.orgId } });
      const sourceProvider = org ? MetaCloudProvider.fromOrg(org) : null;
      if (sourceProvider) {
        try {
          const resolved = await sourceProvider.getMediaUrl(source.media_url);
          buffer = await sourceProvider.downloadMedia(resolved.url);
          mimeType = resolved.mimeType;
        } catch (err) {
          fastify.log.warn({ err, messageId }, 'WPP: no se pudo obtener de Meta el media original a reenviar (¿expiró, más de 30 días?)');
        }
      }
    }
    // "https://maps.google.com/?q=LAT,LNG" - formato fijo que webhook.ts siempre
    // genera (ingestLocationMessage) - único lugar que ya arma este link.
    const locationMatch = isLocation ? source.media_url?.match(/\?q=(-?[\d.]+),(-?[\d.]+)/) : null;

    let forwarded = 0;
    for (const target of targets) {
      const message = await fastify.prisma.ticketMessage.create({
        data: {
          ticket_id: target.id, direction: 'out',
          text: source.text, media_url: source.media_url, media_type: source.media_type,
          media_caption: source.media_caption, sent_by: req.user.userId,
        },
        include: { sender: { select: { id: true, name: true } } },
      });
      forwarded++;
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId: target.id, message: message as any });
      if (target.unread_count > 0) {
        await fastify.prisma.ticket.update({ where: { id: target.id }, data: { unread_count: 0 } });
        fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId: target.id, count: 0 });
      }

      const provider = MetaCloudProvider.fromOrg(target.org);
      if (!provider) {
        fastify.log.warn({ ticketId: target.id }, 'WPP: org sin credenciales Meta, reenvío solo guardado en BD');
        continue;
      }

      if (!source.media_type) {
        // Texto plano - mismo patrón que /reply.
        provider.sendText(target.phone, source.text ?? '')
          .then(async ({ messageId: wppMessageId }) => {
            await fastify.prisma.ticketMessage.update({ where: { id: message.id }, data: { wpp_message_id: wppMessageId } });
            fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message-status', {
              ticketId: target.id, messageId: message.id, delivered: false, read_by_client: false, failed_reason: null,
            });
          })
          .catch(async (err: any) => {
            fastify.log.error({ err, ticketId: target.id }, 'WPP: error reenviando texto via Meta API');
            const failed = await fastify.prisma.ticketMessage.update({
              where: { id: message.id },
              data: { failed_reason: String(err?.message ?? 'Error desconocido Meta API').slice(0, 255) },
              select: { delivered: true, read_by_client: true, failed_reason: true },
            });
            fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message-status', { ticketId: target.id, messageId: message.id, ...failed });
          });
      } else if (isLocation && locationMatch) {
        const [, lat, lng] = locationMatch;
        trackOutboundMediaSend(fastify, req.user.orgId, target.id, message.id,
          provider.sendLocation(target.phone, Number(lat), Number(lng)));
      } else if (hasUploadableMedia && buffer && mimeType) {
        const kind = source.media_type as 'image' | 'audio' | 'video' | 'document';
        const caption = source.text ?? undefined;
        trackOutboundMediaSend(fastify, req.user.orgId, target.id, message.id,
          provider.uploadMedia(buffer, mimeType).then((mediaId) => {
            if (kind === 'image') return provider.sendImage(target.phone, mediaId, caption);
            if (kind === 'video') return provider.sendVideo(target.phone, mediaId, caption);
            if (kind === 'document') return provider.sendDocument(target.phone, mediaId, source.media_caption ?? 'archivo', caption);
            return provider.sendAudio(target.phone, mediaId);
          }));
      }
    }

    return reply.status(201).send({ data: { forwarded, failed: missing } });
  });

  // POST /api/v1/inbox/:ticketId/send-image - staff sends a photo, todos los roles
  // (same access as /reply). Base64 in the JSON body, same shape as files.ts's
  // POST /invoice, rather than multipart - no new upload-parsing dependency needed
  // for what's still a small, staff-only image (5MB cap below).
  fastify.post('/:ticketId/send-image', {
    preHandler: [authenticate],
    bodyLimit: Math.ceil(MAX_IMAGE_BYTES * 1.4) + 100_000, // base64 overhead + JSON framing
  }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({
      data: z.string().min(1),
      mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      caption: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    if (!isSupportedImageMime(body.data.mime_type)) {
      return reply.status(400).send({ error: 'Tipo de imagen no soportado', code: 'VALIDATION_ERROR' });
    }

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: { org: true },
    });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const buffer = Buffer.from(body.data.data, 'base64');
    if (buffer.length === 0) return reply.status(400).send({ error: 'Imagen vacía', code: 'VALIDATION_ERROR' });
    if (buffer.length > MAX_IMAGE_BYTES) {
      return reply.status(400).send({ error: 'Imagen demasiado grande (máx 5 MB)', code: 'VALIDATION_ERROR' });
    }
    // The declared mime_type is just a string the browser sent - never trusted on
    // its own. Checking the real file signature is what actually stops something
    // that isn't a genuine image (mislabeled on purpose or corrupted in transit)
    // from being stored and relayed to Meta as if it were one.
    const realMime = detectImageMime(buffer);
    if (!realMime || realMime !== body.data.mime_type) {
      return reply.status(400).send({ error: 'El archivo no es una imagen válida del tipo indicado', code: 'VALIDATION_ERROR' });
    }

    // Nada de esto se guarda de nuestro lado (ni R2 ni disco) - se sube
    // directo a Meta y SU media_id (no un token propio) es lo que queda en
    // media_url. Por eso hace falta el provider desde ya: sin credenciales de
    // Meta no hay dónde subir el archivo, así que no tiene sentido crear un
    // mensaje que después nunca va a poder mostrarse.
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    if (!provider) {
      return reply.status(422).send({ error: 'Esta organización no tiene credenciales de WhatsApp configuradas', code: 'NO_WPP_CREDENTIALS' });
    }
    let mediaId: string;
    try {
      mediaId = await provider.uploadMedia(buffer, body.data.mime_type);
    } catch (err: any) {
      fastify.log.error({ err, ticketId }, 'WPP: error subiendo imagen a Meta');
      return reply.status(502).send({ error: 'No se pudo subir la imagen a WhatsApp', code: 'WPP_UPLOAD_FAILED' });
    }

    const caption = body.data.caption?.trim() || null;

    const message = await fastify.prisma.ticketMessage.create({
      data: {
        ticket_id: ticketId,
        direction: 'out',
        text: caption,
        media_url: mediaId,
        media_type: 'image',
        media_caption: caption,
        sent_by: req.user.userId,
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });

    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    // El upload ya se esperó arriba (hacía falta el media_id para poder crear
    // el mensaje) - solo el envío en sí queda en segundo plano, igual que /reply.
    trackOutboundMediaSend(fastify, req.user.orgId, ticketId, message.id,
      provider.sendImage(ticket.phone, mediaId, caption ?? undefined));

    return reply.status(201).send({ data: message, wpp_status: 'sending' });
  });

  // Shared tail for every outbound-media route below (audio/video/document) -
  // upload bytes to Meta, send referencing the resulting media id, then update
  // this TicketMessage row with the real wpp_message_id (or failed_reason on
  // error) and tell any connected staff. Fired in the background by every
  // caller, same as send-image's own inline version of this - not factored out
  // there too, to avoid touching an already-working route.
  function trackOutboundMediaSend(
    fastify: FastifyInstance, orgId: string, ticketId: string, messageId: string,
    sendPromise: Promise<{ messageId: string }>,
  ) {
    sendPromise
      .then(async ({ messageId: wppMessageId }) => {
        await fastify.prisma.ticketMessage.update({ where: { id: messageId }, data: { wpp_message_id: wppMessageId } });
        fastify.io.to(`org:${orgId}`).emit('ticket:message-status', {
          ticketId, messageId, delivered: false, read_by_client: false, failed_reason: null,
        });
      })
      .catch(async (err: any) => {
        const wpp_error = err?.message ?? 'Error desconocido Meta API';
        fastify.log.error({ err, ticketId }, 'WPP: error enviando media via Meta API');
        const failed = await fastify.prisma.ticketMessage.update({
          where: { id: messageId },
          data: { failed_reason: String(wpp_error).slice(0, 255) },
          select: { delivered: true, read_by_client: true, failed_reason: true },
        });
        fastify.io.to(`org:${orgId}`).emit('ticket:message-status', { ticketId, messageId, ...failed });
      });
  }

  // POST /api/v1/inbox/:ticketId/send-audio - staff sends a voice note/audio file.
  // WhatsApp's audio type has no caption field at all (see meta-cloud.ts's
  // sendAudio) - nothing to accept here beyond the file itself.
  fastify.post('/:ticketId/send-audio', {
    preHandler: [authenticate],
    bodyLimit: Math.ceil(MAX_AUDIO_BYTES * 1.4) + 100_000,
  }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({
      data: z.string().min(1),
      mime_type: z.enum(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr']),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    if (!isSupportedAudioMime(body.data.mime_type)) {
      return reply.status(400).send({ error: 'Tipo de audio no soportado', code: 'VALIDATION_ERROR' });
    }

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId }, include: { org: true } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const buffer = Buffer.from(body.data.data, 'base64');
    if (buffer.length === 0) return reply.status(400).send({ error: 'Audio vacío', code: 'VALIDATION_ERROR' });
    if (buffer.length > MAX_AUDIO_BYTES) {
      return reply.status(400).send({ error: 'Audio demasiado grande (máx 16 MB)', code: 'VALIDATION_ERROR' });
    }
    const realMime = detectMediaMime(buffer, body.data.mime_type);
    if (!realMime) return reply.status(400).send({ error: 'El archivo no es un audio válido del tipo indicado', code: 'VALIDATION_ERROR' });

    const provider = MetaCloudProvider.fromOrg(ticket.org);
    if (!provider) {
      return reply.status(422).send({ error: 'Esta organización no tiene credenciales de WhatsApp configuradas', code: 'NO_WPP_CREDENTIALS' });
    }
    let mediaId: string;
    try {
      mediaId = await provider.uploadMedia(buffer, body.data.mime_type);
    } catch (err: any) {
      fastify.log.error({ err, ticketId }, 'WPP: error subiendo audio a Meta');
      return reply.status(502).send({ error: 'No se pudo subir el audio a WhatsApp', code: 'WPP_UPLOAD_FAILED' });
    }

    const message = await fastify.prisma.ticketMessage.create({
      data: { ticket_id: ticketId, direction: 'out', media_url: mediaId, media_type: 'audio', sent_by: req.user.userId },
      include: { sender: { select: { id: true, name: true } } },
    });
    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });
    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    trackOutboundMediaSend(fastify, req.user.orgId, ticketId, message.id, provider.sendAudio(ticket.phone, mediaId));
    return reply.status(201).send({ data: message, wpp_status: 'sending' });
  });

  // POST /api/v1/inbox/:ticketId/send-video - staff sends a video, optional caption.
  fastify.post('/:ticketId/send-video', {
    preHandler: [authenticate],
    bodyLimit: Math.ceil(MAX_VIDEO_BYTES * 1.4) + 100_000,
  }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({
      data: z.string().min(1),
      mime_type: z.enum(['video/mp4', 'video/3gpp']),
      caption: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    if (!isSupportedVideoMime(body.data.mime_type)) {
      return reply.status(400).send({ error: 'Tipo de video no soportado', code: 'VALIDATION_ERROR' });
    }

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId }, include: { org: true } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const buffer = Buffer.from(body.data.data, 'base64');
    if (buffer.length === 0) return reply.status(400).send({ error: 'Video vacío', code: 'VALIDATION_ERROR' });
    if (buffer.length > MAX_VIDEO_BYTES) {
      return reply.status(400).send({ error: 'Video demasiado grande (máx 16 MB)', code: 'VALIDATION_ERROR' });
    }
    const realMime = detectMediaMime(buffer, body.data.mime_type);
    if (!realMime) return reply.status(400).send({ error: 'El archivo no es un video válido del tipo indicado', code: 'VALIDATION_ERROR' });

    const provider = MetaCloudProvider.fromOrg(ticket.org);
    if (!provider) {
      return reply.status(422).send({ error: 'Esta organización no tiene credenciales de WhatsApp configuradas', code: 'NO_WPP_CREDENTIALS' });
    }
    let mediaId: string;
    try {
      mediaId = await provider.uploadMedia(buffer, body.data.mime_type);
    } catch (err: any) {
      fastify.log.error({ err, ticketId }, 'WPP: error subiendo video a Meta');
      return reply.status(502).send({ error: 'No se pudo subir el video a WhatsApp', code: 'WPP_UPLOAD_FAILED' });
    }

    const caption = body.data.caption?.trim() || null;
    const message = await fastify.prisma.ticketMessage.create({
      data: { ticket_id: ticketId, direction: 'out', text: caption, media_url: mediaId, media_type: 'video', media_caption: caption, sent_by: req.user.userId },
      include: { sender: { select: { id: true, name: true } } },
    });
    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });
    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    trackOutboundMediaSend(fastify, req.user.orgId, ticketId, message.id,
      provider.sendVideo(ticket.phone, mediaId, caption ?? undefined));
    return reply.status(201).send({ data: message, wpp_status: 'sending' });
  });

  // POST /api/v1/inbox/:ticketId/send-document - staff sends a PDF, optional caption.
  fastify.post('/:ticketId/send-document', {
    preHandler: [authenticate],
    bodyLimit: Math.ceil(MAX_DOCUMENT_BYTES * 1.4) + 100_000,
  }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({
      data: z.string().min(1),
      mime_type: z.enum(['application/pdf']),
      filename: z.string().min(1).max(200),
      caption: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    if (!isSupportedDocumentMime(body.data.mime_type)) {
      return reply.status(400).send({ error: 'Tipo de documento no soportado', code: 'VALIDATION_ERROR' });
    }

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId }, include: { org: true } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const buffer = Buffer.from(body.data.data, 'base64');
    if (buffer.length === 0) return reply.status(400).send({ error: 'Documento vacío', code: 'VALIDATION_ERROR' });
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return reply.status(400).send({ error: 'Documento demasiado grande (máx 100 MB)', code: 'VALIDATION_ERROR' });
    }
    const realMime = detectMediaMime(buffer, body.data.mime_type);
    if (!realMime) return reply.status(400).send({ error: 'El archivo no es un documento válido del tipo indicado', code: 'VALIDATION_ERROR' });

    const provider = MetaCloudProvider.fromOrg(ticket.org);
    if (!provider) {
      return reply.status(422).send({ error: 'Esta organización no tiene credenciales de WhatsApp configuradas', code: 'NO_WPP_CREDENTIALS' });
    }
    let mediaId: string;
    try {
      mediaId = await provider.uploadMedia(buffer, body.data.mime_type);
    } catch (err: any) {
      fastify.log.error({ err, ticketId }, 'WPP: error subiendo documento a Meta');
      return reply.status(502).send({ error: 'No se pudo subir el documento a WhatsApp', code: 'WPP_UPLOAD_FAILED' });
    }

    const caption = body.data.caption?.trim() || null;
    const filename = body.data.filename.trim();
    const message = await fastify.prisma.ticketMessage.create({
      data: { ticket_id: ticketId, direction: 'out', text: caption, media_url: mediaId, media_type: 'document', media_caption: filename, sent_by: req.user.userId },
      include: { sender: { select: { id: true, name: true } } },
    });
    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });
    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    trackOutboundMediaSend(fastify, req.user.orgId, ticketId, message.id,
      provider.sendDocument(ticket.phone, mediaId, filename, caption ?? undefined));
    return reply.status(201).send({ data: message, wpp_status: 'sending' });
  });

  // GET /api/v1/inbox/media/:token - serves a chat photo/audio/video/document
  // (inbound or outbound). Staff-auth only (bearer JWT) - unlike the
  // client-facing invoice/form links, nobody outside the org's own staff
  // session is ever meant to open this.
  //
  // Nada de esto vive de nuestro lado (decisión explícita del negocio - ni R2
  // ni disco ni BD) - `token` acá es el media_id que Meta ya nos dio (ver
  // lib/media.ts), y esta ruta le pide los bytes a Meta EN VIVO cada vez que
  // alguien quiere ver el archivo, en vez de leerlos de un storage propio.
  // Meta solo retiene el media 30 días - pasado eso, esto 404ea con
  // MEDIA_EXPIRED, no hay copia de respaldo que servir.
  fastify.get('/media/:token', { preHandler: [authenticate] }, async (req, reply) => {
    const { token: mediaId } = req.params as { token: string };
    if (!isValidMetaMediaId(mediaId)) {
      req.log.warn({ mediaId }, 'WPP: [DIAG] media_id con formato inválido');
      return reply.status(400).send({ error: 'Identificador inválido' });
    }

    // Confirma que este media_id realmente pertenece a un mensaje de la
    // organización de quien pide - el gate real (antes, y ahora también,
    // la entropía del identificador no alcanza sola como control de acceso).
    const msg = await fastify.prisma.ticketMessage.findFirst({
      where: { media_url: mediaId, ticket: { org_id: req.user.orgId } },
      select: { media_type: true, ticket: { select: { org: { select: { wpp_meta_phone_id: true, wpp_meta_token: true } } } } },
    });
    if (!msg) {
      req.log.warn({ mediaId, orgId: req.user.orgId }, 'WPP: [DIAG] no se encontró mensaje con ese media_id en esta organización');
      return reply.status(404).send({ error: 'Imagen no encontrada', code: 'NOT_FOUND' });
    }

    const provider = MetaCloudProvider.fromOrg(msg.ticket.org);
    if (!provider) {
      req.log.warn({ mediaId, orgId: req.user.orgId }, 'WPP: [DIAG] organización sin credenciales de Meta configuradas');
      return reply.status(404).send({ error: 'Organización sin credenciales de WhatsApp', code: 'NOT_FOUND' });
    }

    let buffer: Buffer;
    let declaredMime: string;
    try {
      const resolved = await provider.getMediaUrl(mediaId);
      declaredMime = resolved.mimeType;
      buffer = await provider.downloadMedia(resolved.url);
    } catch (err) {
      // El caso normal de este catch: pasaron más de 30 días y Meta ya lo
      // borró - no es un error nuestro, es el límite de retención de Meta
      // (aceptado a propósito, no guardamos copia propia de respaldo).
      req.log.warn({ err, mediaId }, 'WPP: no se pudo obtener el media desde Meta (¿expiró, más de 30 días?)');
      return reply.status(404).send({
        error: 'Este archivo ya no está disponible - WhatsApp solo lo retiene 30 días y no guardamos copia propia',
        code: 'MEDIA_EXPIRED',
      });
    }

    // DIAGNÓSTICO TEMPORAL - se quita en cuanto se confirme la causa real del
    // bug reportado (imágenes/audios que no cargan en prod). No expone nada
    // sensible: solo tamaño y los primeros bytes (firma de archivo) del
    // buffer, y el mime que reportó Meta.
    req.log.warn({
      mediaId, declaredMime, mediaType: msg.media_type,
      bufferLength: buffer.length,
      first16BytesHex: buffer.subarray(0, 16).toString('hex'),
    }, 'WPP: [DIAG] media descargado de Meta');

    // Nunca confiar en el mime_type que reporta Meta a secas - se revalida la
    // firma real de los bytes acá, en CADA vista (antes se hacía una sola vez
    // al ingresar el mensaje; ahora, al no guardar nada, este es el único
    // momento en que hay bytes en la mano para revisar - misma defensa,
    // aplicada en otro punto).
    const realMime = msg.media_type === 'image' ? detectImageMime(buffer) : detectMediaMime(buffer, declaredMime);
    if (!realMime) {
      req.log.error({ mediaId, declaredMime }, 'WPP: el archivo que devolvió Meta no coincide con ningún tipo soportado');
      return reply.status(404).send({ error: 'Imagen no encontrada', code: 'NOT_FOUND' });
    }

    // DIAGNÓSTICO TEMPORAL - confirma qué Content-Type se está mandando de
    // verdad en la respuesta exitosa.
    req.log.warn({ mediaId, realMime, bufferLength: buffer.length }, 'WPP: [DIAG] sirviendo media al staff');

    reply.header('Content-Type', realMime);
    reply.header('Cache-Control', 'private, max-age=86400');
    // Stops a browser from ever second-guessing the Content-Type above and
    // trying to sniff/render the bytes as something else (e.g. HTML) if this
    // response is ever opened directly instead of through ChatImage's
    // fetch-as-blob path - the standard defense against a mislabeled upload
    // being executed instead of just failing to display as an image.
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', 'inline');
    return reply.send(buffer);
  });

  // GET /api/v1/inbox/:ticketId/form-link - genera link firmado para el formulario del cliente
  // Token minting + state reset lives in lib/formLink.ts, shared with webhook.ts's
  // auto-send-right-after-welcome (same reasoning: both must reset the exact same
  // fields the exact same way, not drift apart as either gets edited later).
  fastify.get('/:ticketId/form-link', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const url = await generateFormLinkUrl(fastify, ticket.id, req.user.orgId, req.user.userId);
    return reply.send({ data: { url } });
  });

  // POST /api/v1/inbox/:ticketId/form-link/revoke - invalidates the currently
  // outstanding form-link token for this ticket (e.g. sent to the wrong number).
  fastify.post('/:ticketId/form-link/revoke', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({ reason: z.string().max(255).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    await fastify.prisma.revokedFormToken.upsert({
      where: { ticket_id: ticket.id },
      update: { reason: body.data.reason, revoked_at: new Date(), revoked_by: req.user.userId },
      create: { org_id: req.user.orgId, ticket_id: ticket.id, reason: body.data.reason, revoked_by: req.user.userId },
    });

    // A factura sent to this same conversation must die with the form link, not
    // stay quietly downloadable through files.ts's separate mechanism - only
    // touches ones not already opened+expired-out on their own; harmless either way.
    await fastify.prisma.invoiceLink.updateMany({
      where: { ticket_id: ticket.id, org_id: req.user.orgId, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    return reply.send({ data: { ok: true } });
  });

  // POST /api/v1/inbox/form-links/block-all - org-wide kill switch, admin only.
  // Instantly invalidates every currently-outstanding form link across every ticket
  // in the org (e.g. the store closes early one day) - no need to revoke one ticket
  // at a time. A fresh link issued AFTER this moment works normally again; this
  // isn't a permanent shutdown, just "everything sent out as of right now is dead."
  fastify.post('/form-links/block-all', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    await fastify.prisma.organization.update({
      where: { id: req.user.orgId },
      data: { form_links_blocked_at: new Date() },
    });
    return reply.send({ data: { ok: true } });
  });

  // POST /api/v1/inbox/:ticketId/erase-data - derecho de supresión (Ley 1581 de
  // 2012): un cliente pide que se elimine su información. Admin-only, una sola
  // acción sobre el ticket que ya se tiene abierto (por teléfono O por el
  // username/BSUID nuevo de WhatsApp - da igual cuál identificó a este ticket,
  // la lógica es la misma desde acá porque ambos ya viven en la misma fila).
  //
  // No es un DELETE liso y llano de la fila: hay una tensión real entre "borrar
  // todo" y la obligación de conservar el soporte de una venta ya facturada
  // (ver la política publicada). TODOS los pedidos del ticket se ANONIMIZAN
  // (nombre/contacto/teléfono/dirección reemplazados, número/productos/precios
  // intactos - sigue sirviendo como soporte, ya no identifica a nadie) en vez
  // de borrarse - ninguno se borra de verdad, ni siquiera los que nunca se
  // facturaron. No es una preferencia: order_history tiene reglas de Postgres
  // (no_update_order_history / no_delete_order_history) que hacen ese historial
  // deliberadamente INMUTABLE incluso para esta acción - un pedido con aunque
  // sea una fila de historial no se puede borrar (FK ON DELETE RESTRICT), así
  // que la única operación que siempre funciona, sea cual sea el estado del
  // pedido, es anonimizar la fila de `orders` en sí (eso no tiene ninguna regla
  // de inmutabilidad, solo `order_history` la tiene).
  // El ticket en sí NUNCA se borra (los pedidos anonimizados lo siguen
  // referenciando por ticket_id) - se anonimiza igual que ellos.
  // Los mensajes de chat, sesiones de formulario y revocaciones sí se borran
  // del todo (contenido de conversación puro, sin obligación de conservarlos,
  // y sin ninguna regla de inmutabilidad sobre esas tablas).
  //
  // Límites conocidos, documentados a propósito en vez de resueltos acá:
  //   - order_history.value_before/value_after de un cambio anterior de
  //     nombre/teléfono/dirección queda ahí para siempre, sin poder redactarse -
  //     es justo lo que esas reglas de Postgres impiden, a propósito (integridad
  //     del historial de auditoría). Tensión real entre "borrar todo" e
  //     "historial a prueba de manipulación" que esta acción no puede resolver
  //     por sí sola - si hace falta resolverla, es una decisión de negocio
  //     (¿se relaja la inmutabilidad para este caso?), no algo para decidir acá.
  //   - Una nota interna de staff (OrderObservation) podría igual mencionar al
  //     cliente en texto libre - eso no se escanea/redacta, es contenido
  //     escrito por el propio staff, no el dato del cliente en sí.
  fastify.post('/:ticketId/erase-data', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const anonymized = await fastify.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { ticket_id: ticketId, org_id: req.user.orgId },
        data: {
          customer_name: 'Cliente eliminado', client_contact_name: null,
          customer_phone: null, address: '[eliminado a solicitud del cliente]',
        },
      });

      await tx.ticketMessage.deleteMany({ where: { ticket_id: ticketId } });
      await tx.revokedFormToken.deleteMany({ where: { ticket_id: ticketId } });
      await tx.formLinkSession.deleteMany({ where: { ticket_id: ticketId } });
      // Sin relación FK propia hacia Ticket (ver comentario del modelo) - se
      // revocan igual, para que ninguna factura vieja de este cliente siga
      // siendo abrible desde afuera. El PDF en sí (R2) no se borra acá.
      await tx.invoiceLink.updateMany({ where: { ticket_id: ticketId, revoked_at: null }, data: { revoked_at: new Date() } });

      // El ticket queda anonimizado, nunca borrado - lo siguen referenciando
      // los pedidos que se anonimizaron arriba. consent_given_at se deja
      // intacto a propósito: es la prueba de que hubo consentimiento antes de
      // que pidiera esto, no un dato personal en sí mismo.
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          customer_name: 'Cliente eliminado',
          phone: `eliminado-${crypto.randomBytes(8).toString('hex')}`,
          bsuid: null,
          raw_payload: Prisma.DbNull,
          unread_count: 0,
          form_link_token: null, form_link_sent_by: null, form_token_min_iat: null, form_link_opened_at: null,
          link_failed_attempts: 0, link_failed_total: 0, link_blocked_until: null,
        },
      });

      return count;
    });

    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'ticket.erase_customer_data',
      targetId: ticketId, metadata: { ordersAnonymized: anonymized },
    });

    return reply.send({ data: { ok: true, ordersAnonymized: anonymized } });
  });

  // POST /api/v1/inbox/:ticketId/parse-messages - "Tomar lista": staff selects
  // 1+ of the customer's own text messages, an AI extracts product+quantity
  // pairs (services/ai/index.ts, chained free-tier providers), each is matched
  // against the org's real catalog (lib/matchProduct.ts). Pure computation -
  // never writes to the DB, never creates/touches an order. The frontend takes
  // the returned items and drops them into the same draft item list staff
  // already reviews before hitting the real save button (POST/PATCH /orders).
  fastify.post('/:ticketId/parse-messages', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({ messageIds: z.array(z.string().uuid()).min(1).max(50) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const messages = await fastify.prisma.ticketMessage.findMany({
      where: { id: { in: body.data.messageIds }, ticket_id: ticket.id },
    });
    // Every id must resolve to a real message on THIS ticket - catches a stale
    // client (message deleted/moved) or a tampered request (id from another
    // ticket) instead of silently extracting from whatever subset matched.
    if (messages.length !== body.data.messageIds.length) {
      return reply.status(400).send({ error: 'Alguno de los mensajes seleccionados no existe en esta conversación', code: 'INVALID_MESSAGES' });
    }
    // Never trust the frontend's own checkbox gating - only the customer's own
    // plain-text messages are eligible (never staff replies, never media).
    if (messages.some(m => m.direction !== 'in' || !!m.media_type)) {
      return reply.status(400).send({ error: 'Solo se pueden seleccionar mensajes de texto del cliente', code: 'INVALID_MESSAGES' });
    }

    const combinedText = messages
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(m => m.text)
      .filter((t): t is string => !!t && t.trim().length > 0)
      .join('\n');
    if (!combinedText) {
      return reply.status(400).send({ error: 'Los mensajes seleccionados no tienen texto', code: 'INVALID_MESSAGES' });
    }

    const products = await fastify.prisma.product.findMany({
      where: { org_id: req.user.orgId, active: true },
      select: { name: true, price_per_unit: true },
    });
    const catalog = products.map(p => ({ name: p.name, price_per_unit: p.price_per_unit ? Number(p.price_per_unit) : null }));

    let extracted;
    try {
      extracted = await extractOrderItems(combinedText, catalog.map(c => c.name));
    } catch (err) {
      req.log.error({ err }, 'tomar-lista: extracción con IA falló en todos los proveedores');
      return reply.status(502).send({ error: 'No se pudo procesar el texto con IA - intenta de nuevo', code: 'AI_EXTRACTION_FAILED' });
    }

    // Guards against a whitespace-only product_name (passes zod's min(1) on
    // character count, but there's nothing there) - matchProductName would
    // otherwise treat '' as a substring of every catalog entry and could
    // still land a blank-ish line in the draft for staff to puzzle over.
    const matched = extracted.filter(item => item.product_name.trim().length > 0).map(item => {
      const m = matchProductName(item.product_name, catalog);
      return {
        product_name: m.name,
        quantity_label: item.quantity_label ?? '',
        price: m.price,
        added_by_client: false,
        ai_unmatched: !m.matched,
      };
    });
    // Dedupe WITHIN this same extraction (case/accent-insensitive) - the AI
    // can return the same product more than once if the customer mentioned it
    // in more than one selected message (e.g. "quiero papa" ... later "y otra
    // papa"), and two matched mentions of the same catalog product normalize
    // to the identical name. Keeps the first occurrence's quantity_label, no
    // summing - staff bumps the quantity by hand if the customer really meant
    // more. This is independent of (and doesn't know about) whatever the
    // frontend's own draft already has - see lib/tomarLista.ts's
    // mergeExtractedItems on the frontend for that second, separate check.
    const seenNames = new Set<string>();
    const items = matched.filter(i => {
      const key = normalizeSearch(i.product_name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    const unmatchedNames = items.filter(i => i.ai_unmatched).map(i => i.product_name);

    return reply.send({ data: { items, unmatchedNames } });
  });
}
