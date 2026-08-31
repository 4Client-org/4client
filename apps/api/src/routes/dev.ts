import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import { storage } from '../services/storage.js';
import { passwordSchema } from '../lib/password.js';
import { audit } from '../lib/audit.js';
import bcrypt from 'bcrypt';

// "org-name" -> "org-name-slug", sin tildes, minúsculas, solo [a-z0-9-] -
// mismo criterio de slug que ya usa seed.ts/createTestOrg en los tests.
function slugify(name: string): string {
  // NFD + strip combining marks would give nicer slugs for accented names
  // ("Jose\u0301" -> "jose"), but every way tried to embed that unicode
  // range literally in this file kept getting mangled in transit - simpler
  // and just as safe to skip it: an accented letter just gets dropped by the
  // [^a-z0-9]+ pass below like any other non-alphanumeric character ("Jose\u0301"
  // -> "jos-" instead of "jose") - a slightly less pretty slug, never a broken one.
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base || 'org';
}

const ALLOWED_TABLES = [
  'users', 'organizations', 'products', 'employees',
  'orders', 'tickets', 'ticket_messages',
  'order_history', 'daily_closes', 'audit_logs',
] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

async function queryTable(
  prisma: FastifyInstance['prisma'],
  table: AllowedTable,
  orgId: string,
  lim: number,
  off: number,
): Promise<{ rows: any[]; total: number }> {
  switch (table) {
    case 'users':
      return {
        // Excludes password_hash - even though this viewer is dev-role-only, there's
        // no reason a bcrypt hash should ever cross the wire, viewable or not.
        rows: await prisma.user.findMany({
          where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' },
          select: { id: true, org_id: true, email: true, name: true, role: true, active: true, last_login: true, created_at: true },
        }),
        total: await prisma.user.count({ where: { org_id: orgId } }),
      };
    case 'organizations':
      return {
        // Excludes wpp_meta_token/wpp_meta_app_secret - the token is encrypted at rest
        // but the app secret currently isn't, so this masks both rather than leaking
        // one plaintext and one ciphertext blob through a viewer meant for eyeballing
        // data, not handling credentials.
        rows: await prisma.organization.findMany({
          where: { id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' },
          select: {
            id: true, name: true, slug: true, plan: true, wpp_provider: true, wpp_phone: true,
            wpp_meta_phone_id: true, welcome_message: true, active: true, created_at: true,
          },
        }),
        total: await prisma.organization.count({ where: { id: orgId } }),
      };
    case 'products':
      return {
        rows: await prisma.product.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.product.count({ where: { org_id: orgId } }),
      };
    case 'employees':
      return {
        rows: await prisma.employee.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.employee.count({ where: { org_id: orgId } }),
      };
    case 'orders':
      return {
        rows: await prisma.order.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { fecha: 'desc' } }),
        total: await prisma.order.count({ where: { org_id: orgId } }),
      };
    case 'tickets':
      return {
        rows: await prisma.ticket.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.ticket.count({ where: { org_id: orgId } }),
      };
    case 'ticket_messages':
      return {
        rows: await prisma.ticketMessage.findMany({
          where: { ticket: { org_id: orgId } },
          take: lim, skip: off, orderBy: { created_at: 'desc' },
        }),
        total: await prisma.ticketMessage.count({ where: { ticket: { org_id: orgId } } }),
      };
    case 'order_history':
      return {
        rows: await prisma.orderHistory.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.orderHistory.count({ where: { org_id: orgId } }),
      };
    case 'daily_closes':
      return {
        rows: await prisma.dailyClose.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { fecha: 'desc' } }),
        total: await prisma.dailyClose.count({ where: { org_id: orgId } }),
      };
    case 'audit_logs':
      return {
        rows: await prisma.auditLog.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.auditLog.count({ where: { org_id: orgId } }),
      };
  }
}

export default async function devRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('dev'));

  // GET /dev/db?table=users&limit=20&offset=0&orgId=... - orgId is optional,
  // defaults to the dev's own organization. Explicit orgId lets a dev inspect
  // ANY organization's data (needed once there's more than one real client
  // sharing this database) - the only authorization check is still
  // requireRole('dev') above, same as every other route in this file. `dev`
  // is the platform operator role by design, not a tenant - it was never
  // meant to be confined to one organization the way admin/encargado are.
  fastify.get('/db', async (req: any, reply) => {
    const { table = 'users', limit = '20', offset = '0', orgId } = req.query as Record<string, string>;

    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return reply.status(400).send({ error: `Tabla no permitida. Opciones: ${ALLOWED_TABLES.join(', ')}` });
    }
    if (orgId && !z.string().uuid().safeParse(orgId).success) {
      return reply.status(400).send({ error: 'orgId inválido', code: 'VALIDATION_ERROR' });
    }

    const lim = Math.min(parseInt(limit) || 20, 200);
    const off = Math.max(parseInt(offset) || 0, 0);
    const targetOrgId = orgId || req.user.orgId;

    const { rows, total } = await queryTable(fastify.prisma, table as AllowedTable, targetOrgId, lim, off);

    return reply.send({ data: rows, total, limit: lim, offset: off });
  });

  // POST /dev/seed - idempotent upsert of base data
  fastify.post('/seed', async (_req, reply) => {
    // RAILWAY_ENVIRONMENT_NAME, not NODE_ENV - see webhook.ts for why. NODE_ENV is
    // "production" on the dev Railway environment too, which blocked seeding there
    // even though it's exactly the environment this is meant for.
    if (config.RAILWAY_ENVIRONMENT_NAME === 'production') {
      return reply.status(403).send({ error: 'Seed deshabilitado en producción', code: 'FORBIDDEN' });
    }

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    try {
      const p = fastify.prisma;

      const org = await p.organization.upsert({
        where: { slug: 'fruver-san-gabriel' },
        update: {},
        create: {
          name: 'Fruver San Gabriel',
          slug: 'fruver-san-gabriel',
          plan: 'starter',
          wpp_provider: 'meta_api',
          active: true,
        },
      });
      log(`Org: ${org.name} (${org.id})`);

      const [adminHash, devHash] = await Promise.all([
        bcrypt.hash(config.SEED_ADMIN_PASS, 12),
        bcrypt.hash(config.SEED_DEV_PASS, 12),
      ]);

      const admin = await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'admin@fruver.com' } },
        update: { password_hash: adminHash, role: 'admin', active: true },
        create: { org_id: org.id, email: 'admin@fruver.com', password_hash: adminHash, name: 'Juan Ignasio', role: 'admin' },
      });
      log(`Admin: ${admin.email}`);

      await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'dev@fruver.com' } },
        update: { password_hash: devHash, role: 'dev', active: true },
        create: { org_id: org.id, email: 'dev@fruver.com', password_hash: devHash, name: 'Jose Alvarez', role: 'dev' },
      });
      log('Dev: dev@fruver.com');

      const existingCount = await p.product.count({ where: { org_id: org.id } });
      log(`Productos existentes: ${existingCount}`);
      log('Seed completado. Contrasenas: ver vars SEED_ADMIN_PASS y SEED_DEV_PASS');

      return reply.send({ success: true, logs });
    } catch (e: any) {
      logs.push(`Error: ${e.message}`);
      return reply.status(500).send({ success: false, logs, error: e.message });
    }
  });

  // GET /dev/env-status - which optional env vars are configured (boolean only, no values)
  fastify.get('/env-status', async (_req, reply) => {
    return reply.send({
      data: {
        NODE_ENV:                  config.NODE_ENV,
        PORT:                      config.PORT,
        META_WEBHOOK_VERIFY_TOKEN: !!config.META_WEBHOOK_VERIFY_TOKEN,
        META_PHONE_NUMBER_ID:      !!config.META_PHONE_NUMBER_ID,
        META_ACCESS_TOKEN:         !!config.META_ACCESS_TOKEN,
        META_APP_SECRET:           !!config.META_APP_SECRET,
        R2_ACCOUNT_ID:             !!config.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID:          !!config.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY:      !!config.R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME:            !!config.R2_BUCKET_NAME,
        R2_PUBLIC_URL:             !!config.R2_PUBLIC_URL,
        SENTRY_DSN:                !!config.SENTRY_DSN,
      },
    });
  });

  // GET /dev/storage-test - actually tries to upload a tiny test file to R2 (or the
  // local fallback) and reports the real error, instead of just checking env vars are
  // set. env-status only shows booleans - this catches wrong bucket name, bad
  // credentials, etc. that env-status can't see.
  fastify.get('/storage-test', async (_req, reply) => {
    const configured = storage.isConfigured();
    if (!configured) {
      return reply.send({ data: { configured: false, ok: false, detail: 'R2 no configurado - usando almacenamiento local (uploads/)' } });
    }
    try {
      const testKey = `_healthcheck/${Date.now()}.txt`;
      const url = await storage.upload(testKey, Buffer.from('4client storage test'), 'text/plain');
      return reply.send({ data: { configured: true, ok: true, url } });
    } catch (err: any) {
      return reply.send({
        data: {
          configured: true, ok: false,
          error_name: err?.name ?? err?.Code ?? null,
          error_message: err?.message ?? String(err),
        },
      });
    }
  });

  // GET /dev/health - extended health with DB ping
  fastify.get('/health', async (_req, reply) => {
    const start = Date.now();
    const [orgCount, userCount] = await Promise.all([
      fastify.prisma.organization.count(),
      fastify.prisma.user.count(),
    ]);
    return reply.send({
      status: 'ok',
      db_latency_ms: Date.now() - start,
      counts: { organizations: orgCount, users: userCount },
      timestamp: new Date().toISOString(),
      node_version: process.version,
      uptime_s: Math.floor(process.uptime()),
    });
  });

  // ─── Organizaciones (altas de clientes) ────────────────────────────────────

  // GET /dev/organizations - lista TODAS las organizaciones (a diferencia de
  // /dev/db, que siempre queda scopeada a una sola vía orgId) - alimenta el
  // selector de organización objetivo y esta misma pestaña en el frontend.
  fastify.get('/organizations', async (_req, reply) => {
    const orgs = await fastify.prisma.organization.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        id: true, name: true, slug: true, plan: true, active: true, created_at: true,
        _count: { select: { users: true } },
      },
    });
    return reply.send({ data: orgs });
  });

  const createOrgSchema = z.object({
    name:           z.string().min(2).max(200),
    slug:           z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'solo minúsculas, números y guiones').optional(),
    admin_name:     z.string().min(2).max(200),
    admin_email:    z.string().email(),
    admin_password: passwordSchema,
  });

  // POST /dev/organizations - alta de un cliente nuevo: crea la Organization +
  // su primer usuario admin en una sola transacción. Las credenciales del
  // admin se devuelven UNA sola vez en la respuesta (igual que cualquier flujo
  // de "te muestro la clave una sola vez") - no quedan recuperables después
  // (password_hash nunca se expone, ni siquiera acá).
  fastify.post('/organizations', async (req: any, reply) => {
    const body = createOrgSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    let slug = body.data.slug ?? slugify(body.data.name);
    const clash = await fastify.prisma.organization.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${randomBytes(2).toString('hex')}`;

    const email = body.data.admin_email.toLowerCase();
    const password_hash = await bcrypt.hash(body.data.admin_password, 12);

    try {
      const { org, admin } = await fastify.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: body.data.name, slug, plan: 'starter', wpp_provider: 'meta_api', active: true },
        });
        const admin = await tx.user.create({
          data: { org_id: org.id, name: body.data.admin_name, email, password_hash, role: 'admin', active: true },
        });
        return { org, admin };
      });

      await audit(fastify.prisma, {
        orgId: org.id, actorId: req.user.userId, action: 'dev.org_created',
        targetId: org.id, metadata: { admin_email: admin.email },
      });

      return reply.status(201).send({
        data: {
          organization: { id: org.id, name: org.name, slug: org.slug },
          admin: { email: admin.email, password: body.data.admin_password },
        },
      });
    } catch {
      return reply.status(500).send({ error: 'No se pudo crear la organización', code: 'SERVER_ERROR' });
    }
  });

  // ─── Acciones curadas (reemplazan los favores manuales de SQL) ─────────────

  const reopenCierreSchema = z.object({
    orgId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  // POST /dev/actions/reopen-cierre - reproduce exactamente lo hecho a mano
  // esta sesión para reabrir el cierre de producción: borra el DailyClose de
  // esa fecha (si existe) para que la app vuelva a considerar el día abierto.
  // Deliberadamente NO ofrece "cerrar" - cerrar de verdad implica recalcular
  // totales reales (POST /cierre, ya existe y hace eso bien) - inventar un
  // cierre falso acá con totales en cero corrompería la contabilidad real.
  // El snapshot completo del cierre borrado queda en audit_logs antes de
  // borrarlo, por si hace falta reconstruirlo a mano después.
  fastify.post('/actions/reopen-cierre', async (req: any, reply) => {
    const body = reopenCierreSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    const { orgId, fecha } = body.data;

    const existing = await fastify.prisma.dailyClose.findUnique({
      where: { org_id_fecha: { org_id: orgId, fecha: new Date(fecha) } },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Esa fecha ya está abierta - no hay cierre que reabrir', code: 'NOT_FOUND' });
    }

    await fastify.prisma.dailyClose.delete({ where: { id: existing.id } });
    await audit(fastify.prisma, {
      orgId, actorId: req.user.userId, action: 'dev.cierre_reopened',
      targetId: existing.id, metadata: { fecha, snapshot: JSON.parse(JSON.stringify(existing)) },
    });

    return reply.send({ data: { action: 'reopened', previous: existing } });
  });

  const createTestTicketSchema = z.object({
    orgId:         z.string().uuid(),
    phone:         z.string().min(5).max(150),
    customer_name: z.string().min(1).max(200),
    fecha:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mensajes:      z.array(z.string().min(1).max(2000)).min(1).max(20),
  });

  // POST /dev/actions/create-test-ticket - reproduce lo hecho hoy a mano para
  // probar el catálogo de WhatsApp: un Ticket + sus TicketMessage (entrantes)
  // en un solo paso, con un teléfono falso - no dispara ningún envío real por
  // WhatsApp, solo sirve para ver la UI (Chats WPP, Tomar lista, catálogo...)
  // con datos de prueba sin escribir SQL a mano.
  fastify.post('/actions/create-test-ticket', async (req: any, reply) => {
    const body = createTestTicketSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    const { orgId, phone, customer_name, fecha, mensajes } = body.data;

    const org = await fastify.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });

    const dup = await fastify.prisma.ticket.findUnique({ where: { org_id_phone: { org_id: orgId, phone } } });
    if (dup) return reply.status(409).send({ error: 'Ya existe un ticket con ese teléfono en esta organización', code: 'CONFLICT' });

    const now = new Date();
    const ticket = await fastify.prisma.ticket.create({
      data: {
        org_id: orgId, phone, customer_name, fecha: new Date(fecha),
        first_message_today_at: now, last_message_at: now, last_activity_at: now,
        unread_count: mensajes.length,
      },
    });

    // Timestamps escalonados (más viejo -> más nuevo) para que el orden de los
    // mensajes en el chat quede igual al orden en que se escribieron acá.
    await fastify.prisma.ticketMessage.createMany({
      data: mensajes.map((text, i) => {
        const at = new Date(now.getTime() - (mensajes.length - i) * 60_000);
        return { ticket_id: ticket.id, direction: 'in', text, sent_at: at, created_at: at };
      }),
    });

    await audit(fastify.prisma, {
      orgId, actorId: req.user.userId, action: 'dev.test_ticket_created',
      targetId: ticket.id, metadata: { phone, customer_name, fecha, mensajes_count: mensajes.length },
    });

    return reply.status(201).send({ data: { ticket_id: ticket.id } });
  });

  // ─── Facturación a organizaciones (cobros de la plataforma) ────────────────

  // GET /dev/charges?orgId=&status= - ambos filtros opcionales; sin ninguno,
  // devuelve los cobros de TODAS las organizaciones (vista del operador).
  fastify.get('/charges', async (req: any, reply) => {
    const { orgId, status } = req.query as Record<string, string>;
    if (orgId && !z.string().uuid().safeParse(orgId).success) {
      return reply.status(400).send({ error: 'orgId inválido', code: 'VALIDATION_ERROR' });
    }
    const where: Record<string, string> = {};
    if (orgId) where.org_id = orgId;
    if (status) where.status = status;

    const charges = await fastify.prisma.platformCharge.findMany({
      where, orderBy: { due_date: 'asc' },
      include: { org: { select: { name: true, slug: true } } },
    });
    return reply.send({ data: charges });
  });

  const createChargeSchema = z.object({
    orgId:       z.string().uuid(),
    type:        z.enum(['suscripcion', 'onboarding', 'otro']),
    period:      z.string().regex(/^\d{4}-\d{2}$/).optional(),
    amount:      z.number().positive(),
    due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:       z.string().max(1000).optional(),
    // El PDF se arma en el navegador (jsPDF, mismo patrón que la factura de
    // pedidos en DetallePedidoModal.tsx) y se manda ya listo - este endpoint
    // solo lo sube a R2 (services/storage.ts) y guarda el registro.
    pdf_base64:  z.string().optional(),
  });

  // POST /dev/charges - crea un cobro nuevo en estado 'pendiente'. Si viene un
  // PDF y R2 está configurado, lo sube y guarda su URL - si falla la subida o
  // R2 no está configurado en este ambiente, el registro se guarda igual (solo
  // sin report_url), nunca se pierde el cobro por un problema de storage.
  fastify.post('/charges', async (req: any, reply) => {
    const body = createChargeSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const org = await fastify.prisma.organization.findUnique({ where: { id: body.data.orgId } });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });

    let report_url: string | null = null;
    if (body.data.pdf_base64 && storage.isConfigured()) {
      try {
        const buf = Buffer.from(body.data.pdf_base64, 'base64');
        const key = `platform-charges/${org.slug}-${Date.now()}.pdf`;
        report_url = await storage.upload(key, buf, 'application/pdf');
      } catch {
        report_url = null;
      }
    }

    const charge = await fastify.prisma.platformCharge.create({
      data: {
        org_id: body.data.orgId, type: body.data.type, period: body.data.period ?? null,
        amount: body.data.amount, due_date: new Date(body.data.due_date),
        notes: body.data.notes ?? null, report_url, created_by: req.user.userId,
      },
    });

    await audit(fastify.prisma, {
      orgId: body.data.orgId, actorId: req.user.userId, action: 'dev.charge_created',
      targetId: charge.id, metadata: { type: body.data.type, amount: body.data.amount },
    });

    return reply.status(201).send({ data: charge });
  });

  // PATCH /dev/charges/:id - marcar pagado/pendiente.
  fastify.patch('/charges/:id', async (req: any, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['pendiente', 'pagado']) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const charge = await fastify.prisma.platformCharge.update({
      where: { id },
      data: { status: body.data.status, paid_at: body.data.status === 'pagado' ? new Date() : null },
    }).catch(() => null);
    if (!charge) return reply.status(404).send({ error: 'Cobro no encontrado', code: 'NOT_FOUND' });

    await audit(fastify.prisma, {
      orgId: charge.org_id, actorId: req.user.userId, action: 'dev.charge_status_changed',
      targetId: charge.id, metadata: { status: body.data.status },
    });

    return reply.send({ data: charge });
  });
}
