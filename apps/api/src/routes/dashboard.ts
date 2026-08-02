import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard?fecha=2026-06-15 - solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const [orders, papeleraOrders, creditoOrders, history, tickets, dailyClose] = await Promise.all([
      // client_deleted excluded - "se hace de cuenta que no existe" for every
      // stat/total on this page (it's still fully visible, red-flagged, on the
      // live board itself - just not counted here, same as papelera).
      fastify.prisma.order.findMany({
        where: { org_id: req.user.orgId, fecha, status: { not: 'papelera' }, client_deleted: false },
        include: { items: true, employee: { select: { id: true, name: true } } },
      }),
      // Papelera tab now also surfaces client_deleted orders (status untouched by
      // that flow, see public.ts/schema.prisma) so staff can find/restore them
      // from "Informe del día" too, not only from the live board.
      fastify.prisma.order.findMany({
        where: { org_id: req.user.orgId, fecha, OR: [{ status: 'papelera' }, { client_deleted: true }] },
        include: { items: true, papeleraBy: { select: { id: true, name: true } } },
      }),
      // NOT scoped to `fecha` like everything else here - a crédito order stays
      // relevant (unpaid, on this list) for as long as it takes to actually
      // collect, which routinely spans well past the day it was created. Not
      // filtered by `paid` either anymore - the Créditos tab now has its own
      // Pagados/No pagados sub-tabs, so it needs BOTH to split between them
      // (previously paying one just made it vanish from here entirely, with no
      // way to look it back up).
      fastify.prisma.order.findMany({
        where: { org_id: req.user.orgId, payment_method: 'credito' },
        include: { items: true, employee: { select: { id: true, name: true } } },
        orderBy: { fecha: 'desc' },
      }),
      fastify.prisma.orderHistory.findMany({
        where: { org_id: req.user.orgId, order: { fecha } },
        include: {
          actor: { select: { id: true, name: true } },
          order: { select: { num: true, customer_name: true, client_contact_name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 300,
      }),
      fastify.prisma.ticket.findMany({
        // Same resolution as GET /tickets (the swimlane board) - a ticket whose order
        // was deferred to another day only gets `deferred_to` set, its own `fecha`
        // stays put, so a plain `{ fecha }` match here silently dropped it from
        // whichever day it actually landed on and left it double-counted on the day
        // it left, undercounting/overcounting "chats completados" around any deferral.
        where: {
          org_id: req.user.orgId,
          OR: [
            { fecha },
            { deferred_to: fecha },
            { orders: { some: { fecha } } },
          ],
        },
        include: {
          // Scoped to `fecha` too, not just non-papelera - a ticket is now one row
          // per phone forever (not per day), so without this it pulls in EVERY order
          // that ticket has ever had across its whole history. A chat whose 3 orders
          // today are all paid+cerrado was still coming back "activo" here because
          // some unrelated order from a different day, sitting on the same ticket,
          // wasn't closed - this is what "chats completados"/"con pedido activo"
          // meant to reflect right now, today, not the ticket's entire lifetime.
          orders: {
            where: { status: { not: 'papelera' }, fecha, client_deleted: false },
            select: { status: true, paid: true },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
      fastify.prisma.dailyClose.findUnique({
        where: { org_id_fecha: { org_id: req.user.orgId, fecha } },
        include: { closedBy: { select: { name: true } } },
      }),
    ]);

    // Same phone dedup as GET /tickets - belt-and-suspenders now that a phone can
    // only ever have one ticket row (@@unique(org_id, phone) on Ticket).
    const seenPhones = new Set<string>();
    const tickets_ = tickets.filter(t => {
      if (seenPhones.has(t.phone)) return false;
      seenPhones.add(t.phone);
      return true;
    });

    // Order stats
    const total = orders.length;
    const cerrados = orders.filter(o => o.status === 'cerrado').length;
    const pendientes = orders.filter(o => o.status !== 'cerrado').length;
    const domActivos = orders.filter(o =>
      ['preparando', 'listo', 'camino'].includes(o.status) && o.employee_id
    ).length;

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    // Cash collected by a domiciliario on delivery (cod), separate from cash
    // paid in-store (cash) - both are "efectivo" for the revenue total, but
    // only the cod portion is money that has to physically come BACK from a
    // domiciliario at the end of the day. Whether that specific order was
    // "completo" or "con vuelta" doesn't change this number - a vuelta order's
    // change already nets out (domiciliario collects amount_received, hands
    // the client change_amount back, keeps exactly `tot`), so `tot` (the
    // order's own total) is always the right figure to expect from them
    // either way.
    let totalDomiciliario = 0;
    // Same figure broken down per domiciliario - "who owes how much" is more
    // directly actionable at the end of the day than just one lump sum.
    const porDomiciliario: Record<string, number> = {};
    // Explicit status==='cerrado' guard alongside paid, same reasoning as
    // cierre.ts's own totals query - makes it impossible for a real-money
    // total to include an order sitting in some other status.
    orders.filter(o => o.paid && o.status === 'cerrado').forEach(o => {
      const tot = o.items.reduce((s, i) => s + Number(i.price), 0);
      // Split payment (part efectivo, part transferencia) routes each piece
      // into its own bucket instead of the whole total going to just one -
      // same reasoning as cierre.ts's identical totals computation.
      if ((o as any).split_cash != null && (o as any).split_transfer != null) {
        totalEfectivo += Number((o as any).split_cash);
        totalTransferencia += Number((o as any).split_transfer);
      } else if (o.payment_method === 'cash' || o.payment_method === 'cod') {
        totalEfectivo += tot;
      } else if (o.payment_method === 'transfer') {
        totalTransferencia += tot;
      }
      if (o.payment_method === 'cod') {
        totalDomiciliario += tot;
        const name = (o as any).employee?.name ?? 'Sin asignar';
        porDomiciliario[name] = (porDomiciliario[name] ?? 0) + tot;
      }
    });

    // Chat stats
    const totalChats = tickets_.length;
    const chatsSinPedido = tickets_.filter(t => t.orders.length === 0).length;
    const chatsCompletos = tickets_.filter(t =>
      t.orders.length > 0 && t.orders.every(o => o.paid || o.status === 'cerrado')
    ).length;
    const chatsActivos = tickets_.filter(t =>
      t.orders.some(o => !o.paid && o.status !== 'cerrado')
    ).length;

    return reply.send({
      data: {
        totales: { total, entregados: cerrados, pendientes, domActivos },
        chats: { total: totalChats, sinPedido: chatsSinPedido, activos: chatsActivos, completos: chatsCompletos },
        recaudado: {
          efectivo: totalEfectivo,
          transferencia: totalTransferencia,
          total: totalEfectivo + totalTransferencia,
          // What domiciliarios collectively owe back today (cobro en casa
          // orders only) - a subset of `efectivo`, broken out separately so
          // it can be reconciled against what they actually hand over.
          domiciliario: totalDomiciliario,
          porDomiciliario,
        },
        orders,
        papeleraOrders,
        creditoOrders,
        history,
        // `decisions` (per-order action taken at cierre time) travels along too - lets
        // the frontend rebuild the exact same CSV report on demand, any time after the
        // close, instead of only within the one live session that actually ran it.
        cierre: dailyClose
          ? { cerrado: true, closedAt: dailyClose.closed_at, closedByName: dailyClose.closedBy?.name ?? null, decisions: dailyClose.decisions ?? {} }
          : { cerrado: false },
      },
    });
  });
}
