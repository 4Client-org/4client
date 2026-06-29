import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export default async function publicRoutes(fastify: FastifyInstance) {
  // POST /api/v1/public/register — client submits their info (no auth required)
  fastify.post('/register', async (req, reply) => {
    const body = z.object({
      org_slug:      z.string().min(1).max(50),
      customer_name: z.string().min(1).max(200),
      phone:         z.string().min(7).max(20),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const org = await fastify.prisma.organization.findFirst({
      where: { slug: body.data.org_slug, active: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });

    // Colombia UTC-5 local date
    const today = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    const ticket = await fastify.prisma.ticket.upsert({
      where: { org_id_phone_fecha: { org_id: org.id, phone: body.data.phone, fecha: today } },
      update: { customer_name: body.data.customer_name },
      create: {
        org_id: org.id,
        phone: body.data.phone,
        customer_name: body.data.customer_name,
        fecha: today,
        last_message_at: new Date(),
      },
    });

    return reply.status(201).send({ data: { ok: true, ticketId: ticket.id } });
  });

  // GET /api/v1/public/org/:slug — verify org exists (for the client form)
  fastify.get('/org/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const org = await fastify.prisma.organization.findFirst({
      where: { slug, active: true },
      select: { id: true, name: true, slug: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });
    return reply.send({ data: org });
  });
}
