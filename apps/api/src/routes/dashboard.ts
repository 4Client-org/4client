import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard?fecha=2026-06-15 — solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const orders = await fastify.prisma.order.findMany({
      where: { org_id: req.user.orgId, fecha, status: { not: 'papelera' } },
      include: { items: true, employee: { select: { id: true, name: true } } },
    });

    const total = orders.length;
    const entregados = orders.filter(o => o.status === 'cerrado').length;
    const pendientes = orders.filter(o => o.status !== 'cerrado').length;
    const domActivos = orders.filter(o =>
      ['preparando', 'listo', 'camino'].includes(o.status) && o.employee_id
    ).length;

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    orders.filter(o => o.paid).forEach(o => {
      const tot = o.items.reduce((s, i) => s + Number(i.price), 0);
      if (o.payment_method === 'cash' || o.payment_method === 'cod') totalEfectivo += tot;
      else if (o.payment_method === 'transfer') totalTransferencia += tot;
    });

    return reply.send({
      data: {
        totales: { total, entregados, pendientes, domActivos },
        recaudado: {
          efectivo: totalEfectivo,
          transferencia: totalTransferencia,
          total: totalEfectivo + totalTransferencia,
        },
        orders,
      },
    });
  });
}
