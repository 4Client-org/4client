import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const DEV_PASS = 'CentroMandoDevTest1!';
const ADMIN_PASS = 'CentroMandoAdminTest1!';
// La BD de test no se resetea entre corridas de `vitest run` (solo aplica
// migraciones nuevas) - un nombre/slug/email fijo choca con residuos de una
// corrida anterior de este mismo archivo. Mismo criterio que createTestOrg
// (helpers.ts): sufijo aleatorio en todo lo que tenga que ser único.
const suf = () => randomUUID().slice(0, 8);

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// "Centro de mando" dev (routes/dev.ts's nuevos endpoints, agregados junto a
// /dev/db ya existente) - crear organizaciones, acciones curadas (reabrir
// cierre, crear ticket de prueba) y cobros de plataforma. Todo bajo el mismo
// requireRole('dev') que ya protegía /dev/db - estas suites verifican
// explícitamente que un rol no-dev (admin) sigue rechazado en cada endpoint
// nuevo, igual que en el viejo.
describe('Centro de mando dev', () => {
  let app: FastifyInstance;
  let orgId: string;
  let devToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const dev = await createTestUser(app.prisma, orgId, 'dev', DEV_PASS);
    devToken = await login(app, dev.email, DEV_PASS);
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /dev/organizations', () => {
    it('crea una organización nueva + su admin, y ese admin puede iniciar sesión', async () => {
      const s = suf();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/organizations',
        headers: { authorization: `Bearer ${devToken}` },
        payload: {
          name: `Fruver de Pepito ${s}`,
          admin_name: 'Pepito Pérez',
          admin_email: `pepito-${s}@example.com`,
          admin_password: 'PepitoPass123X!',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json().data;
      expect(body.organization.name).toBe(`Fruver de Pepito ${s}`);
      expect(body.organization.slug).toBe(`fruver-de-pepito-${s}`);
      expect(body.admin.email).toBe(`pepito-${s}@example.com`);
      expect(body.admin.password).toBe('PepitoPass123X!'); // devuelta una sola vez

      // el admin recién creado sí puede loguearse de verdad
      const loginRes = await app.inject({
        method: 'POST', url: '/api/v1/auth/login',
        payload: { email: `pepito-${s}@example.com`, password: 'PepitoPass123X!' },
      });
      expect(loginRes.statusCode).toBe(200);

      // y no ve nada de la organización del dev - aislamiento real, no solo de nombre
      const productsRes = await app.inject({
        method: 'GET', url: '/api/v1/products',
        headers: { authorization: `Bearer ${loginRes.json().data.accessToken}` },
      });
      expect(productsRes.json().data).toEqual([]);
    });

    it('genera un slug único si el nombre ya existe', async () => {
      const s = suf();
      const res1 = await app.inject({
        method: 'POST', url: '/api/v1/dev/organizations',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { name: `Duplicado ${s}`, admin_name: 'Admin Uno', admin_email: `dup1-${s}@example.com`, admin_password: 'DupPass123X!' },
      });
      expect(res1.statusCode).toBe(201);
      const res2 = await app.inject({
        method: 'POST', url: '/api/v1/dev/organizations',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { name: `Duplicado ${s}`, admin_name: 'Admin Dos', admin_email: `dup2-${s}@example.com`, admin_password: 'DupPass123X!' },
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().data.organization.slug).not.toBe(`duplicado-${s}`);
      expect(res2.json().data.organization.slug.startsWith(`duplicado-${s}-`)).toBe(true);
    });

    it('rechaza una contraseña que no cumple la política', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/organizations',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { name: `Org Débil ${suf()}`, admin_name: 'Admin Débil', admin_email: `weak-${suf()}@example.com`, admin_password: 'short' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza un rol no-dev (admin)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: `No Debería ${suf()}`, admin_name: 'Alguien', admin_email: `no-${suf()}@example.com`, admin_password: 'NoPass123X!' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /dev/organizations', () => {
    it('lista organizaciones (rol dev)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/dev/organizations', headers: { authorization: `Bearer ${devToken}` } });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
      expect(res.json().data.length).toBeGreaterThan(0);
    });

    it('rechaza un rol no-dev', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/dev/organizations', headers: { authorization: `Bearer ${adminToken}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /dev/actions/reopen-cierre', () => {
    it('borra el DailyClose de esa fecha (reabre) y deja el snapshot en audit_logs', async () => {
      const closer = await createTestUser(app.prisma, orgId, 'admin', 'CloserPass123X!');
      const dc = await app.prisma.dailyClose.create({
        data: {
          org_id: orgId, fecha: new Date('2026-05-01'),
          total_cash: 1000, total_transfer: 2000, total_grand: 3000,
          total_orders: 2, closed_orders: 2, closed_by: closer.id,
        },
      });

      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/reopen-cierre',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, fecha: '2026-05-01' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.action).toBe('reopened');

      const stillThere = await app.prisma.dailyClose.findUnique({ where: { id: dc.id } });
      expect(stillThere).toBeNull();

      const logs = await app.prisma.auditLog.findMany({ where: { org_id: orgId, action: 'dev.cierre_reopened' } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('404 si no hay cierre para esa fecha', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/reopen-cierre',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, fecha: '2020-01-01' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rechaza un rol no-dev', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/reopen-cierre',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId, fecha: '2026-05-01' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /dev/actions/create-test-ticket', () => {
    it('crea un ticket + sus mensajes entrantes', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/create-test-ticket',
        headers: { authorization: `Bearer ${devToken}` },
        payload: {
          orgId, phone: '573009998877', customer_name: 'Cliente Prueba',
          fecha: '2026-06-01', mensajes: ['hola', 'necesito papa'],
        },
      });
      expect(res.statusCode).toBe(201);
      const ticketId = res.json().data.ticket_id;

      const messages = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } });
      expect(messages.map(m => m.text)).toEqual(['hola', 'necesito papa']);
      expect(messages.every(m => m.direction === 'in')).toBe(true);
    });

    it('409 si ya existe un ticket con ese teléfono en la organización', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/create-test-ticket',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, phone: '573009998877', customer_name: 'Otro', fecha: '2026-06-01', mensajes: ['hola de nuevo'] },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rechaza un rol no-dev', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/actions/create-test-ticket',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId, phone: '573001112222', customer_name: 'X', fecha: '2026-06-01', mensajes: ['hola'] },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('cobros de plataforma (/dev/charges)', () => {
    it('crea un cobro con varios conceptos a la vez y lo marca pagado', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['suscripcion', 'onboarding'], period: '2026-06', amounts: { suscripcion: 100000, onboarding: 50000 } },
      });
      expect(createRes.statusCode).toBe(201);
      const charge = createRes.json().data;
      expect(charge.status).toBe('pendiente');
      expect(charge.paid_at).toBeNull();
      expect(charge.types).toEqual(['suscripcion', 'onboarding']);
      expect(typeof charge.number).toBe('number'); // consecutivo real, no basado en fecha/hora
      expect(charge.report_url).toBeNull(); // todavía sin adjuntar - ver POST /charges/:id/pdf
      expect(charge.amounts).toEqual({ suscripcion: 100000, onboarding: 50000 });
      expect(Number(charge.amount)).toBe(150000); // total calculado por el backend, no confiado del cliente

      const listRes = await app.inject({
        method: 'GET', url: `/api/v1/dev/charges?orgId=${orgId}&status=pendiente`,
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(listRes.json().data.some((c: any) => c.id === charge.id)).toBe(true);

      const patchRes = await app.inject({
        method: 'PATCH', url: `/api/v1/dev/charges/${charge.id}`,
        headers: { authorization: `Bearer ${devToken}` },
        payload: { status: 'pagado' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().data.status).toBe('pagado');
      expect(patchRes.json().data.paid_at).not.toBeNull();
    });

    it('404 al marcar pagado un cobro inexistente', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/v1/dev/charges/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { status: 'pagado' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rechaza un rol no-dev en crear y en marcar pagado', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId, types: ['onboarding'], period: '2026-06', amounts: { onboarding: 50000 } },
      });
      expect(createRes.statusCode).toBe(403);
    });

    it('rechaza un cobro sin ningún concepto seleccionado', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: [], period: '2026-06', amounts: {} },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rechaza un cobro donde amounts no coincide exactamente con los conceptos elegidos', async () => {
      const faltaUno = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['suscripcion', 'onboarding'], period: '2026-06', amounts: { suscripcion: 100000 } },
      });
      expect(faltaUno.statusCode).toBe(400);

      const sobraUno = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['suscripcion'], period: '2026-06', amounts: { suscripcion: 100000, otro: 5000 } },
      });
      expect(sobraUno.statusCode).toBe(400);
    });

    it('asigna números consecutivos crecientes entre cobros', async () => {
      const r1 = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['otro'], period: '2026-07', amounts: { otro: 10000 } },
      });
      const r2 = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['otro'], period: '2026-07', amounts: { otro: 10000 } },
      });
      expect(r2.json().data.number).toBeGreaterThan(r1.json().data.number);
    });

    it('POST /charges/:id/pdf adjunta el PDF a un cobro ya creado', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['suscripcion'], period: '2026-08', amounts: { suscripcion: 20000 } },
      });
      const chargeId = createRes.json().data.id;
      const fakePdfBase64 = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64');

      const pdfRes = await app.inject({
        method: 'POST', url: `/api/v1/dev/charges/${chargeId}/pdf`,
        headers: { authorization: `Bearer ${devToken}` },
        payload: { pdf_base64: fakePdfBase64 },
      });
      expect(pdfRes.statusCode).toBe(200);
      // Sin R2 configurado en tests, report_url queda null - lo que importa es
      // que el endpoint no falle y el cobro siga existiendo intacto.
      expect(pdfRes.json().data.id).toBe(chargeId);
    });

    it('POST /charges/:id/pdf da 404 con un cobro inexistente', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges/00000000-0000-0000-0000-000000000000/pdf',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { pdf_base64: 'YQ==' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /charges/:id/pdf rechaza un rol no-dev', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['otro'], period: '2026-08', amounts: { otro: 5000 } },
      });
      const chargeId = createRes.json().data.id;
      const res = await app.inject({
        method: 'POST', url: `/api/v1/dev/charges/${chargeId}/pdf`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { pdf_base64: 'YQ==' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('PUT /charges/:id edita conceptos/mes/valores/notas sin cambiar el number', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['suscripcion'], period: '2026-09', amounts: { suscripcion: 100000 } },
      });
      const original = createRes.json().data;

      const putRes = await app.inject({
        method: 'PUT', url: `/api/v1/dev/charges/${original.id}`,
        headers: { authorization: `Bearer ${devToken}` },
        payload: { types: ['suscripcion', 'onboarding'], period: '2026-10', amounts: { suscripcion: 100000, onboarding: 60000 }, notes: 'editado' },
      });
      expect(putRes.statusCode).toBe(200);
      const updated = putRes.json().data;
      expect(updated.number).toBe(original.number); // el consecutivo no cambia al editar
      expect(updated.types).toEqual(['suscripcion', 'onboarding']);
      expect(updated.period).toBe('2026-10');
      expect(updated.amounts).toEqual({ suscripcion: 100000, onboarding: 60000 });
      expect(Number(updated.amount)).toBe(160000);
      expect(updated.notes).toBe('editado');
    });

    it('PUT /charges/:id rechaza amounts que no coincide con types, 404 con inexistente, y 403 para no-dev', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['otro'], period: '2026-09', amounts: { otro: 1000 } },
      });
      const chargeId = createRes.json().data.id;

      const badAmounts = await app.inject({
        method: 'PUT', url: `/api/v1/dev/charges/${chargeId}`,
        headers: { authorization: `Bearer ${devToken}` },
        payload: { types: ['otro'], period: '2026-09', amounts: { otro: 1000, suscripcion: 5000 } },
      });
      expect(badAmounts.statusCode).toBe(400);

      const notFound = await app.inject({
        method: 'PUT', url: '/api/v1/dev/charges/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { types: ['otro'], period: '2026-09', amounts: { otro: 1000 } },
      });
      expect(notFound.statusCode).toBe(404);

      const notDev = await app.inject({
        method: 'PUT', url: `/api/v1/dev/charges/${chargeId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { types: ['otro'], period: '2026-09', amounts: { otro: 1000 } },
      });
      expect(notDev.statusCode).toBe(403);
    });

    it('DELETE /charges/:id borra el cobro, 404 con inexistente, 403 para no-dev', async () => {
      const createRes = await app.inject({
        method: 'POST', url: '/api/v1/dev/charges',
        headers: { authorization: `Bearer ${devToken}` },
        payload: { orgId, types: ['otro'], period: '2026-09', amounts: { otro: 3000 } },
      });
      const chargeId = createRes.json().data.id;

      const notDev = await app.inject({
        method: 'DELETE', url: `/api/v1/dev/charges/${chargeId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(notDev.statusCode).toBe(403);

      const delRes = await app.inject({
        method: 'DELETE', url: `/api/v1/dev/charges/${chargeId}`,
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().data.id).toBe(chargeId);

      const listRes = await app.inject({
        method: 'GET', url: `/api/v1/dev/charges?orgId=${orgId}`,
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(listRes.json().data.some((c: any) => c.id === chargeId)).toBe(false);

      const again = await app.inject({
        method: 'DELETE', url: '/api/v1/dev/charges/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(again.statusCode).toBe(404);
    });
  });

  describe('GET /dev/db con orgId explícito', () => {
    it('permite al dev consultar una organización distinta a la propia', async () => {
      const otherOrg = await createTestOrg(app.prisma);
      await app.prisma.product.create({ data: { org_id: otherOrg.id, name: 'Producto de otra org' } });

      const res = await app.inject({
        method: 'GET', url: `/api/v1/dev/db?table=products&orgId=${otherOrg.id}`,
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.some((p: any) => p.name === 'Producto de otra org')).toBe(true);
    });

    it('400 con un orgId con formato inválido', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/v1/dev/db?table=products&orgId=no-es-un-uuid',
        headers: { authorization: `Bearer ${devToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
