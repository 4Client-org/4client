import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';

// Vista de facturación PARA el cliente (admin de su propia organización) -
// distinto de /dev/charges (routes/dev.ts), que es la consola del operador
// de la plataforma y puede apuntar a CUALQUIER organización, crear cobros,
// marcarlos pagados, etc. Esta ruta es de solo lectura y siempre queda
// scopeada a la propia organización del que pregunta - un admin nunca puede
// ver ni tocar los cobros de otra organización.
//
// No hace falta ningún mecanismo para "empujar" la factura al admin cuando
// el dev la crea - PlatformCharge.org_id ya queda escrito desde que
// /dev/charges la crea, así que esta consulta simplemente la encuentra de
// una vez, sin ningún paso extra.
export default async function billingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin', 'dev'));

  // GET /billing/charges - cobros de la PROPIA organización, más reciente
  // primero (por período, que es lo que el usuario ve como "el mes de la
  // factura" - ver DevBillingPanel.tsx, mismo criterio de orden).
  fastify.get('/charges', async (req, reply) => {
    const charges = await fastify.prisma.platformCharge.findMany({
      where: { org_id: req.user.orgId },
      orderBy: [{ period: 'desc' }, { created_at: 'desc' }],
    });
    return reply.send({ data: charges });
  });
}
