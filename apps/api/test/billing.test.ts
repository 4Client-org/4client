import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'BillingTestAdmin1!';
const DEV_PASS = 'BillingTestDev1!';
const ENCARGADO_PASS = 'BillingTestEncargado1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// GET /billing/charges - vista de solo lectura para el admin de SU PROPIA
// organización, de lo que el operador (rol dev) le generó desde
// /dev/charges (routes/dev.ts). No hay ningún paso de "sincronizar" - un
// cobro creado por dev ya tiene el org_id correcto, esta ruta solo lo
// encuentra scopeado a esa organización.
describe('GET /billing/charges', () => {
  let app: FastifyInstance;
  let orgId: string;
  let otherOrgId: string;
  let adminToken: string;
  let devToken: string;
  let encargadoToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const otherOrg = await createTestOrg(app.prisma);
    otherOrgId = otherOrg.id;

    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
    const dev = await createTestUser(app.prisma, orgId, 'dev', DEV_PASS);
    devToken = await login(app, dev.email, DEV_PASS);
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS);
    encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('el admin ve sus propias facturas, más reciente primero por mes, y nunca las de otra organización', async () => {
    const devUser = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'dev' } });
    // Fuera de orden a propósito, para comprobar que el orden lo pone la
    // consulta (period desc) y no el orden de inserción.
    await app.prisma.platformCharge.create({
      data: { org_id: orgId, types: ['suscripcion'], period: '2026-07', amount: 100000, created_by: devUser.id },
    });
    await app.prisma.platformCharge.create({
      data: { org_id: orgId, types: ['onboarding'], period: '2026-09', amount: 300000, created_by: devUser.id },
    });
    await app.prisma.platformCharge.create({
      data: { org_id: orgId, types: ['suscripcion'], period: '2026-08', amount: 150000, created_by: devUser.id },
    });
    // Factura de OTRA organización - nunca debe aparecer.
    await app.prisma.platformCharge.create({
      data: { org_id: otherOrgId, types: ['otro'], period: '2026-09', amount: 999999, created_by: devUser.id },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/billing/charges', headers: { authorization: `Bearer ${adminToken}` } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.map((c: any) => c.period)).toEqual(['2026-09', '2026-08', '2026-07']); // desc
    expect(data.every((c: any) => c.org_id === orgId)).toBe(true);
    expect(data.some((c: any) => Number(c.amount) === 999999)).toBe(false); // nada de la otra org
  });

  it('el rol dev también puede ver la vista de su propia organización', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/billing/charges', headers: { authorization: `Bearer ${devToken}` } });
    expect(res.statusCode).toBe(200);
  });

  it('rechaza un rol que no sea admin/dev (encargado)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/billing/charges', headers: { authorization: `Bearer ${encargadoToken}` } });
    expect(res.statusCode).toBe(403);
  });
});
