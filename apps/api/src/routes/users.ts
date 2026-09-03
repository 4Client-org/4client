import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { authenticate, requireRole } from '../middleware/auth.js';
import { passwordSchema } from '../lib/password.js';
import { audit } from '../lib/audit.js';

// Preparación para el futuro login por nombre de usuario (todavía no
// implementado - /login sigue pidiendo email) - opcional por ahora, así se
// puede ir completando desde Configuración > Usuarios sin obligar a
// llenarlo en cuentas ya existentes. Se normaliza a minúsculas igual que
// email, para que la unicidad no dependa de mayúsculas/minúsculas.
const usernameSchema = z.string().trim().toLowerCase()
  .min(3, 'Mínimo 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[a-z0-9._-]+$/, 'Solo minúsculas, números, puntos, guiones y guion bajo');

const createUserSchema = z.object({
  name:     z.string().min(2),
  email:    z.string().email(),
  username: usernameSchema.optional(),
  password: passwordSchema,
  role:     z.enum(['admin', 'encargado', 'domiciliario']),
});

const updateUserSchema = z.object({
  name:     z.string().min(2).optional(),
  email:    z.string().email().optional(),
  username: usernameSchema.optional(),
  role:     z.enum(['admin', 'encargado', 'domiciliario']).optional(),
  active:   z.boolean().optional(),
});

const resetPassSchema = z.object({
  password: passwordSchema,
});

export default async function userRoutes(fastify: FastifyInstance) {
  // GET /api/v1/users - list org users, admin only
  fastify.get('/', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const users = await fastify.prisma.user.findMany({
      // An admin (not dev) never sees dev-role accounts at all - not just blocked
      // from acting on them, they don't appear in the list in the first place, so
      // there's nothing to even suggest they could be edited/reset/deactivated.
      where: { org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      select: { id: true, name: true, email: true, username: true, role: true, active: true, last_login: true, created_at: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ data: users });
  });

  // POST /api/v1/users - create user in org, admin only
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Global, no scopeado a esta organización - el email es único en toda la
    // plataforma (@@unique([email]) en schema.prisma), no solo dentro de un
    // mismo tenant. Sin este chequeo previo, un choque con OTRA organización
    // llegaría crudo a la DB como un P2002 sin capturar acá (500 genérico en
    // vez de este 409 explicando qué pasó).
    const existing = await fastify.prisma.user.findFirst({
      where: { email: body.data.email.toLowerCase() },
    });
    if (existing) return reply.status(409).send({ error: 'Ese email ya está registrado en la plataforma', code: 'DUPLICATE_EMAIL' });

    // Mismo criterio que email arriba - único en toda la plataforma.
    if (body.data.username) {
      const usernameTaken = await fastify.prisma.user.findFirst({ where: { username: body.data.username } });
      if (usernameTaken) return reply.status(409).send({ error: 'Ese nombre de usuario ya está en uso', code: 'DUPLICATE_USERNAME' });
    }

    const password_hash = await bcrypt.hash(body.data.password, 12);
    const user = await fastify.prisma.user.create({
      data: {
        org_id: req.user.orgId,
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        username: body.data.username,
        password_hash,
        role: body.data.role,
      },
      select: { id: true, name: true, email: true, username: true, role: true, active: true, created_at: true },
    });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.create',
      targetId: user.id, metadata: { email: user.email, role: user.role },
    });
    return reply.status(201).send({ data: user });
  });

  // PATCH /api/v1/users/:id - update user (name, role, active), admin only
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateUserSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Prevent admin from deactivating themselves
    if (id === req.user.userId && body.data.active === false) {
      return reply.status(400).send({ error: 'No puedes desactivarte a ti mismo', code: 'SELF_DEACTIVATE' });
    }

    // Check email uniqueness if changing email - global, mismo motivo que en
    // el POST de arriba (email único en toda la plataforma, no por org).
    if (body.data.email) {
      const conflict = await fastify.prisma.user.findFirst({
        where: { email: body.data.email.toLowerCase(), id: { not: id } },
      });
      if (conflict) return reply.status(409).send({ error: 'Ese email ya está registrado en la plataforma', code: 'DUPLICATE_EMAIL' });
    }

    // Mismo criterio que email arriba.
    if (body.data.username) {
      const usernameConflict = await fastify.prisma.user.findFirst({
        where: { username: body.data.username, id: { not: id } },
      });
      if (usernameConflict) return reply.status(409).send({ error: 'Ese nombre de usuario ya está en uso', code: 'DUPLICATE_USERNAME' });
    }

    const updateData = { ...body.data, ...(body.data.email ? { email: body.data.email.toLowerCase() } : {}) };
    const result = await fastify.prisma.user.updateMany({
      // An admin can never touch a dev-role account (only another dev can) - matched
      // out here the same way the list above hides it, so this 404s exactly like a
      // nonexistent id instead of a distinguishable "forbidden".
      where: { id, org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      data: updateData,
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.update',
      targetId: id, metadata: updateData,
    });
    return reply.send({ data: { ok: true } });
  });

  // POST /api/v1/users/:id/reset-password - admin resets any user's password
  fastify.post('/:id/reset-password', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = resetPassSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'La contraseña debe tener mínimo 12 caracteres, con mayúscula, minúscula y número', code: 'VALIDATION_ERROR' });

    const password_hash = await bcrypt.hash(body.data.password, 12);
    const result = await fastify.prisma.user.updateMany({
      where: { id, org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      data: { password_hash },
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    // Un reseteo de contraseña es casi siempre por sospecha de cuenta
    // comprometida - sin esto, una sesión ya robada seguía siendo válida
    // hasta por 7 días más (la vida del refresh token), pese a que el admin
    // ya "arregló" el problema cambiando la clave. Cierra todos los
    // dispositivos de una vez; el usuario tiene que volver a iniciar sesión
    // con la contraseña nueva en cada uno.
    await fastify.prisma.refreshToken.updateMany({
      where: { user_id: id, revoked: false },
      data: { revoked: true },
    });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.reset_password', targetId: id,
    });
    return reply.send({ data: { ok: true } });
  });
}
