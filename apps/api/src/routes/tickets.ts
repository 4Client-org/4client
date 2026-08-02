import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function ticketRoutes(fastify: FastifyInstance) {
  // GET /api/v1/tickets?fecha=2026-06-15
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const allTickets = await fastify.prisma.ticket.findMany({
      where: {
        org_id: req.user.orgId,
        OR: [
          { fecha },
          { deferred_to: fecha },
          // A ticket must show up wherever any of its own orders actually live, even if
          // `deferred_to` was never set on it (e.g. orders deferred before this field was
          // wired up, or any other path that moves an order's fecha directly) - the
          // order's own fecha is the source of truth, not a separate field that can drift.
          { orders: { some: { fecha } } },
        ],
      },
      include: {
        messages: { orderBy: { created_at: 'asc' } },
        // Scoped to `fecha` too - a ticket is one row per phone forever now (not per
        // day), so without this a heavily-used chat's badge/count here would include
        // every order across its whole history instead of just what's relevant to the
        // day being viewed.
        // client_deleted excluded too - used by MainPage's "crear pedido" dedup
        // (reopen an existing resumable order instead of duplicating); a
        // client-deleted order is frozen pending staff review, not something a
        // fresh "crear pedido" click should silently resume into.
        orders: {
          where: { status: { not: 'papelera' }, fecha, client_deleted: false },
          select: { id: true, num: true, status: true, paid: true },
        },
      },
      // first_message_today_at, not created_at (a returning customer's created_at
      // is from whenever they FIRST ever wrote, possibly weeks ago) and not
      // last_message_at either (that one keeps moving forward every time this
      // customer writes AGAIN today, which silently drops a ticket down the
      // board the more active it is - confirmed as a real prod bug: a ticket's
      // first message at 8am with a follow-up at 2pm was sorting as if it had
      // just arrived at 2pm). first_message_today_at is set once, on the first
      // inbound message of the day, and never touched again until tomorrow -
      // this is what actually makes "first to arrive stays first" hold for the
      // whole day. NULLS FIRST: a ticket showing today purely via deferred_to/
      // an order's own fecha with no new message yet has no value here at all -
      // it's carried over from before today, so it belongs ahead of every
      // genuinely new arrival, not sorted after them by a Postgres default.
      orderBy: { first_message_today_at: { sort: 'asc', nulls: 'first' } },
    });

    // Deduplicate by phone: keep only the first per phone (prefer fecha match over deferred_to match)
    const seenPhones = new Set<string>();
    const tickets = allTickets.filter(t => {
      if (seenPhones.has(t.phone)) return false;
      seenPhones.add(t.phone);
      return true;
    });

    return reply.send({ data: tickets });
  });

  // POST /api/v1/tickets - crear ticket manual
  fastify.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = z.object({
      phone:         z.string().min(7),
      customer_name: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Colombia UTC-5: derive local business date from UTC
    const today = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    // One ticket per phone forever - reopening an existing conversation rolls it
    // forward to today instead of leaving it (and this route) unable to find it.
    const ticket = await fastify.prisma.ticket.upsert({
      where: { org_id_phone: { org_id: req.user.orgId, phone: body.data.phone } },
      update: { customer_name: body.data.customer_name ?? body.data.phone, fecha: today, deferred_to: null, first_message_today_at: new Date() },
      create: {
        org_id: req.user.orgId,
        phone: body.data.phone,
        customer_name: body.data.customer_name ?? body.data.phone,
        fecha: today,
        last_message_at: new Date(),
        last_activity_at: new Date(),
        first_message_today_at: new Date(),
      },
    });

    return reply.status(201).send({ data: ticket });
  });

  // PATCH /api/v1/tickets/:id - rename a ticket and/or change its associated
  // phone number, admin-only (same sensitivity tier as the block-all-links
  // action in inbox.ts - this touches identity, not just display). Propagates
  // to every order already linked to this ticket in the same transaction, so
  // "Chats WPP" isn't the only place staff sees the correction.
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      customer_name: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().min(7).max(150).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    if (body.data.customer_name === undefined && body.data.phone === undefined) {
      return reply.status(400).send({ error: 'Nada que actualizar', code: 'VALIDATION_ERROR' });
    }

    const existing = await fastify.prisma.ticket.findFirst({ where: { id, org_id: req.user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Ticket no encontrado', code: 'NOT_FOUND' });

    const newPhone = body.data.phone;
    const oldPhone = existing.phone;
    // No merge support yet (grep confirms nothing in this codebase reassigns
    // messages/orders between tickets) - a real merge would need to move every
    // TicketMessage/Order from the loser ticket to the survivor, which is a much
    // bigger feature. Reject clearly instead of a raw @@unique([org_id, phone])
    // constraint violation.
    if (newPhone !== undefined && newPhone !== oldPhone) {
      const collision = await fastify.prisma.ticket.findFirst({ where: { org_id: req.user.orgId, phone: newPhone } });
      if (collision) return reply.status(409).send({ error: 'Ya existe un chat con ese número - fusionar chats no está soportado todavía', code: 'PHONE_TAKEN' });
    }

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.update({
        where: { id },
        data: {
          ...(body.data.customer_name !== undefined ? { customer_name: body.data.customer_name } : {}),
          // A real number staff just typed in is by definition reachable - clears
          // the "arrived with nothing" flag if it was ever set.
          ...(newPhone !== undefined ? { phone: newPhone, no_wpp_number: false } : {}),
        },
      });

      const orders = await tx.order.findMany({
        where: { ticket_id: id },
        select: { id: true, customer_name: true, customer_phone: true },
      });

      for (const order of orders) {
        const data: Record<string, string> = {};
        const historyEntries: { field: string; value_before: string; value_after: string }[] = [];

        if (body.data.customer_name !== undefined && order.customer_name !== body.data.customer_name) {
          data.customer_name = body.data.customer_name;
          historyEntries.push({ field: 'Nombre', value_before: order.customer_name, value_after: body.data.customer_name });
        }
        // Only bulk-update customer_phone on orders whose value still matches the
        // ticket's OLD phone exactly - an order where staff already manually typed
        // a different real number (this session's own phone-edit feature, orders.ts
        // PATCH /:id) must not be silently clobbered by this ticket-wide change.
        if (newPhone !== undefined && order.customer_phone === oldPhone) {
          data.customer_phone = newPhone;
          historyEntries.push({ field: 'Teléfono', value_before: order.customer_phone ?? '', value_after: newPhone });
        }

        if (Object.keys(data).length > 0) {
          await tx.order.update({ where: { id: order.id }, data });
          await tx.orderHistory.createMany({
            data: historyEntries.map(h => ({
              org_id: req.user.orgId, order_id: order.id, actor_id: req.user.userId,
              action_type: 'edit', field: h.field,
              value_before: h.value_before, value_after: h.value_after,
              notes: 'Actualizado desde el chat (Chats WPP)',
            })),
          });
        }
      }

      return { ticket, orderIds: orders.map(o => o.id) };
    });

    // Per-order emit (no `.items` in the payload) - DetallePedidoModal/board/inbox
    // already fall back to invalidate-and-refetch for a partial order:updated
    // payload (see DetallePedidoModal's own socket handler), same as this. A
    // ticket with zero orders yet simply has nothing to broadcast here - it'll
    // pick up the rename on its next natural refetch.
    for (const orderId of updated.orderIds) {
      fastify.io.to(`org:${req.user.orgId}`).emit('order:updated', { id: orderId } as any);
    }

    return reply.send({ data: updated.ticket });
  });
}
