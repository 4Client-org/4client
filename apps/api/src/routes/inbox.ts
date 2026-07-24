import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { generateFormLinkUrl } from '../lib/formLink.js';

export default async function inboxRoutes(fastify: FastifyInstance) {
  // GET /api/v1/inbox - lista de todas las conversaciones, solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ page: z.coerce.number().default(1) }).parse(req.query);

    const allTickets = await fastify.prisma.ticket.findMany({
      where: { org_id: req.user.orgId },
      include: {
        messages: { orderBy: { sent_at: 'desc' }, take: 1 },
        orders: {
          where: { status: { not: 'papelera' } },
          select: { id: true, num: true, status: true, paid: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
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
          orderBy: { sent_at: 'asc' },
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

    // Enviar via Meta Cloud API
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    let wpp_status: 'sent' | 'no_credentials' | 'failed' = 'no_credentials';
    let wpp_error: string | undefined;

    if (provider) {
      try {
        // Capturing and storing this is the whole point - webhook.ts's ingestStatus
        // matches every later delivered/read/failed status update by THIS id
        // (wpp_message_id). Without saving it here, every status Meta ever sends for
        // this message has nothing to match against and is silently dropped -
        // DeliveryStatus.tsx stays stuck on a single gray check forever, never a
        // failure either, indistinguishable from "still sending".
        const { messageId } = await provider.sendText(ticket.phone, body.data.text);
        await fastify.prisma.ticketMessage.update({ where: { id: message.id }, data: { wpp_message_id: messageId } });
        // Without this, the chat already open on someone's screen (the 'ticket:message'
        // emit above fired BEFORE this id existed) never learns wpp_message_id is now
        // set - DeliveryStatus.tsx is gated on that being truthy, so the check mark
        // stayed invisible until something else happened to trigger a refetch (the
        // next poll, or - only for THIS message - its own first real delivered/read
        // webhook, which is exactly the delay that made this look broken).
        fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message-status', {
          ticketId, messageId: message.id, delivered: false, read_by_client: false, failed_reason: null,
        });
        wpp_status = 'sent';
      } catch (err: any) {
        wpp_status = 'failed';
        wpp_error = err?.message ?? 'Error desconocido Meta API';
        fastify.log.error({ err, ticketId }, 'WPP: error enviando respuesta via Meta API');
        // Recorded on the message itself (not just returned in this HTTP response) so
        // DeliveryStatus shows the red "no se pudo entregar" X - e.g. WhatsApp's 24h
        // customer-service-window policy rejecting a business-initiated message with
        // no active session. Broadcast so anyone else with this chat already open
        // (not just whoever clicked send) sees it update live, same as a real Meta
        // webhook status would.
        const failed = await fastify.prisma.ticketMessage.update({
          where: { id: message.id },
          data: { failed_reason: String(wpp_error).slice(0, 255) },
          select: { delivered: true, read_by_client: true, failed_reason: true },
        });
        fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message-status', {
          ticketId, messageId: message.id, ...failed,
        });
      }
    } else {
      fastify.log.warn({ ticketId }, 'WPP: org sin credenciales Meta, mensaje solo guardado en BD');
    }

    return reply.status(201).send({ data: message, wpp_status, wpp_error });
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
}
