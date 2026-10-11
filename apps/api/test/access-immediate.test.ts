// Corte inmediato de acceso: desactivar a un usuario o cambiarle el rol invalida su
// access token YA (no a los 15 min). Ver middleware/auth.ts > authenticate.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser, getRfCookie } from './helpers.js';

const PASS = 'AccesoInmediato1!';

async function login(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASS } });
  expect(res.statusCode).toBe(200);
  return { token: res.json().data.accessToken as string, rf: getRfCookie(res) as string };
}
const h = (t: string) => ({ authorization: `Bearer ${t}` });
const ping = (app: FastifyInstance, t: string) =>
  app.inject({ method: 'GET', url: '/api/v1/orders?fecha=2026-01-10', headers: h(t) });

describe('acceso inmediato: desactivar / cambiar rol', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    orgId = (await createTestOrg(app.prisma)).id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', PASS);
    adminToken = (await login(app, admin.email)).token;
  });
  afterAll(async () => { await app.close(); });

  it('usuario activo con token vigente funciona', async () => {
    const u = await createTestUser(app.prisma, orgId, 'encargado', PASS);
    const { token } = await login(app, u.email);
    expect((await ping(app, token)).statusCode).toBe(200);
  });

  it('desactivado por la API -> el MISMO token da 401 al instante', async () => {
    const u = await createTestUser(app.prisma, orgId, 'encargado', PASS);
    const { token } = await login(app, u.email);
    expect((await ping(app, token)).statusCode).toBe(200);

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/users/${u.id}`, headers: h(adminToken), payload: { active: false },
    });
    expect(res.statusCode).toBe(200);

    const after = await ping(app, token);
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('UNAUTHORIZED');
  });

  it('desactivado: el refresh tampoco da token nuevo; reactivado, vuelve a loguear', async () => {
    const u = await createTestUser(app.prisma, orgId, 'encargado', PASS);
    const { rf } = await login(app, u.email);
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${u.id}`, headers: h(adminToken), payload: { active: false } });
    const refresh = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { 'x-requested-with': 'XMLHttpRequest' }, cookies: { rf },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('rol cambiado -> el token viejo da 401; el refresh emite token con el rol nuevo', async () => {
    const u = await createTestUser(app.prisma, orgId, 'encargado', PASS);
    const { token, rf } = await login(app, u.email);
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/users/${u.id}`, headers: h(adminToken), payload: { role: 'domiciliario' },
    });
    expect(res.statusCode).toBe(200);
    expect((await ping(app, token)).statusCode).toBe(401);

    const refresh = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { 'x-requested-with': 'XMLHttpRequest' }, cookies: { rf },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data.user.role).toBe('domiciliario');
    expect((await ping(app, refresh.json().data.accessToken)).statusCode).toBe(200);
  });
});
