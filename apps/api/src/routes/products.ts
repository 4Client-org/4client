import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sortByCategoryOrder } from '../lib/categoryOrder.js';

const productSchema = z.object({
  name:           z.string().min(1),
  category:       z.string().optional(),
  active:         z.boolean().default(true),
  sort_order:     z.number().default(0),
  price_per_unit: z.number().optional(),
  unit_type:      z.string().optional(),
});

export default async function productRoutes(fastify: FastifyInstance) {
  // GET /api/v1/products
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const products = await fastify.prisma.product.findMany({
      where: { org_id: req.user.orgId, active: true },
      orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ data: sortByCategoryOrder(products) });
  });

  // POST /api/v1/products - solo admin
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = productSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const product = await fastify.prisma.product.create({
      data: { ...body.data, org_id: req.user.orgId },
    });
    // Every other open session (other staff, and the always-current admin panel)
    // shares the `['products']` react-query cache key but is a separate browser
    // tab/QueryClient - without this, catalog edits only applied to the admin's own
    // tab and everyone else kept the stale list for up to staleTime (5 min), or
    // forever on the public client form (fetched once on load, no polling).
    fastify.io.to(`org:${req.user.orgId}`).emit('product:changed', { id: product.id });
    return reply.status(201).send({ data: product });
  });

  // PATCH /api/v1/products/bulk-price - solo admin. Precio-solo, en lote (ver
  // lib/productExcel.ts en el frontend - esto es lo que recibe tras parsear el
  // Excel re-subido en el navegador, nunca el archivo en sí). Declarada ANTES
  // de PATCH /:id por convención de lectura, aunque find-my-way (el router de
  // Fastify) ya prioriza rutas estáticas sobre las paramétricas sin importar
  // el orden de registro - "bulk-price" nunca cae en `:id`.
  fastify.patch('/bulk-price', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = z.object({
      updates: z.array(z.object({
        id: z.string().uuid(),
        price_per_unit: z.number().min(0),
      })).min(1).max(500),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Cada fila puede traer un precio DISTINTO - a diferencia de todo otro
    // `updateMany` de este archivo (mismo `data` para todo el `where`), acá se
    // recorre una por una dentro de una transacción para que un lote a medias
    // nunca quede aplicado si algo falla a mitad de camino.
    const notFound: string[] = [];
    await fastify.prisma.$transaction(async (tx) => {
      for (const u of body.data.updates) {
        const result = await tx.product.updateMany({
          where: { id: u.id, org_id: req.user.orgId },
          data: { price_per_unit: u.price_per_unit },
        });
        if (result.count === 0) notFound.push(u.id);
      }
    });

    const updated = body.data.updates.length - notFound.length;
    // Un solo evento para todo el lote (no uno por fila) - un Excel de 300
    // filas no debería disparar 300 refetches en cada cliente conectado.
    fastify.io.to(`org:${req.user.orgId}`).emit('product:changed', { bulk: true });
    return reply.send({ data: { updated, notFound } });
  });

  // PATCH /api/v1/products/:id - solo admin
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = productSchema.partial().safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const product = await fastify.prisma.product.updateMany({
      where: { id, org_id: req.user.orgId },
      data: body.data,
    });
    if (product.count === 0) return reply.status(404).send({ error: 'Producto no encontrado', code: 'NOT_FOUND' });
    fastify.io.to(`org:${req.user.orgId}`).emit('product:changed', { id });
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/v1/products/:id - soft delete, solo admin
  fastify.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await fastify.prisma.product.updateMany({
      where: { id, org_id: req.user.orgId },
      data: { active: false },
    });
    fastify.io.to(`org:${req.user.orgId}`).emit('product:changed', { id });
    return reply.send({ data: { ok: true } });
  });
}
