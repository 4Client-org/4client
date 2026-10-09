import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.js';
import { encryptSecret } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_MESSAGE_TEMPLATES, messageTemplatesPatchSchema, resolveMessageTemplates } from '../lib/messageTemplates.js';

export default async function configRoutes(fastify: FastifyInstance) {
  // GET /api/v1/config/message-templates - textos efectivos de la org para los
  // botones del chat. Cualquier rol de la org los lee (encargado y domiciliario
  // también mandan formulario y cuenta de banco), por eso no lleva requireRole.
  fastify.get('/message-templates', { preHandler: [authenticate] }, async (req, reply) => {
    const org = await fastify.prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { message_templates: true },
    });
    return reply.send({ data: { templates: resolveMessageTemplates(org?.message_templates), defaults: DEFAULT_MESSAGE_TEMPLATES } });
  });

  // PUT /api/v1/config/message-templates - edita los textos de la org. Una clave
  // en null (o vacía) vuelve al default. Solo admin y dev, igual que el resto de
  // Configuración.
  fastify.put('/message-templates', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const body = messageTemplatesPatchSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const org = await fastify.prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { message_templates: true },
    });
    const current = (org?.message_templates && typeof org.message_templates === 'object' ? org.message_templates : {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(body.data)) {
      if (value === undefined) continue;
      if (value === null) delete next[key];
      else next[key] = value;
    }

    await fastify.prisma.organization.update({
      where: { id: req.user.orgId },
      data: { message_templates: next as Prisma.InputJsonValue },
    });
    // Solo se registran las claves tocadas, no el texto completo.
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'config.message_templates_update',
      metadata: { fields: Object.keys(body.data) },
    });
    // Sin esto, cualquier sesión que ya tenía los textos en caché (useMessageTemplates,
    // staleTime 5 min) seguía mandando el texto viejo al cliente hasta que esa caché
    // expirara sola - un cambio acá no se veía reflejado al enviar el formulario desde
    // otra pestaña/dispositivo hasta 5 minutos después. Mismo patrón que product:changed
    // (products.ts/useProducts.ts).
    fastify.io.to(`org:${req.user.orgId}`).emit('message-templates:changed');
    return reply.send({ data: { templates: resolveMessageTemplates(next) } });
  });

  // GET /api/v1/config/org - get org config visible to admin/dev
  fastify.get('/org', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const org = await fastify.prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: {
        id: true, name: true, slug: true, plan: true,
        wpp_provider: true, wpp_phone: true,
        wpp_meta_phone_id: true,
        welcome_message: true, wpp_redirect_message: true,
        active: true, created_at: true,
      },
    });
    return reply.send({ data: org });
  });

  // PATCH /api/v1/config/wpp - update WPP credentials + welcome message
  fastify.patch('/wpp', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const body = z.object({
      wpp_meta_phone_id: z.string().min(1).optional(),
      wpp_meta_token:    z.string().min(1).optional(),
      wpp_phone:         z.string().optional(),
      welcome_message:   z.string().max(1000).optional().nullable(),
      // Ver comentario en schema.prisma - cuando está seteado, reemplaza por
      // completo el flujo de bienvenida+formulario (pensado para un número
      // retirado/redirigido a otro).
      wpp_redirect_message: z.string().max(1000).optional().nullable(),
    }).safeParse(req.body);

    if (!body.success) {
      const fields = Object.keys(body.error.flatten().fieldErrors);
      req.log.warn(`WPP config validation failed for fields: ${fields.join(', ')}`);
      return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR', details: body.error.format() });
    }

    const { wpp_meta_token, ...rest } = body.data;

    let updated;
    try {
      updated = await fastify.prisma.organization.update({
        where: { id: req.user.orgId },
        data: {
          ...rest,
          ...(wpp_meta_token !== undefined ? { wpp_meta_token: encryptSecret(wpp_meta_token, req.user.orgId) } : {}),
        },
        select: {
          wpp_meta_phone_id: true, wpp_phone: true, welcome_message: true, wpp_redirect_message: true,
        },
      });
    } catch (err) {
      // wpp_meta_phone_id is @unique (security-audit fix - prevents one org from
      // hijacking another org's inbound WhatsApp traffic by claiming its phone
      // number id) - a P2002 here means this exact number is already registered
      // to a DIFFERENT organization, not a generic server error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({
          error: 'Este número de WhatsApp ya está configurado en otra organización.',
          code: 'PHONE_ID_ALREADY_IN_USE',
        });
      }
      throw err;
    }

    // Records which fields changed, never the token value itself.
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'config.wpp_update',
      metadata: { fields: Object.keys(body.data) },
    });

    return reply.send({ data: updated });
  });
}
