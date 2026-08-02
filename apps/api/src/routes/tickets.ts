import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';

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
      // last_message_at, not created_at - a ticket is one row per phone forever, so
      // a returning customer's created_at is from whenever they FIRST ever wrote
      // (possibly weeks ago), which sorted them ahead of every genuinely new
      // conversation today regardless of when they actually wrote today. ASC keeps
      // the existing "longest waiting first" intent, just on the field that
      // actually reflects recent activity (updated on every inbound/outbound
      // message in webhook.ts/inbox.ts).
      orderBy: { last_message_at: 'asc' },
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
      update: { customer_name: body.data.customer_name ?? body.data.phone, fecha: today, deferred_to: null },
      create: {
        org_id: req.user.orgId,
        phone: body.data.phone,
        customer_name: body.data.customer_name ?? body.data.phone,
        fecha: today,
        last_message_at: new Date(),
        last_activity_at: new Date(),
      },
    });

    return reply.status(201).send({ data: ticket });
  });
}
