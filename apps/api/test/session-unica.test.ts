// Sesión única de admin y dev (decisión de José, 2026-10-10): un login nuevo deja vigente
// solo a esa sesión; las anteriores dejan de servir al instante. El encargado y el
// domiciliario conservan varias sesiones a la vez. Ver middleware/auth.ts y routes/auth.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser, getRfCookie } from './helpers.js';

const PASS = 'SesionUnica1!Abc';

async function login(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASS } });
  expect(res.statusCode).toBe(200);
  return { token: res.json().data.accessToken as string, rf: getRfCookie(res) as string };
}
const h = (t: string) => ({ authorization: `Bearer ${t}` });
const ping = (app: FastifyInstance, t: string) =>
  app.inject({ method: 'GET', url: '/api/v1/orders?fecha=2026-01-10', headers: h(t) });
const refresh = (app: FastifyInstance, rf: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-requested-with': 'XMLHttpRequest' }, cookies: { rf } });

describe('sesión única de admin y dev', () => {
  let app: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    app = await buildTestServer();
    orgId = (await createTestOrg(app.prisma)).id;
  });
  afterAll(async () => { await app.close(); });

  for (const role of ['admin', 'dev'] as const) {
    it(`${role}: un segundo login cierra la sesión anterior al instante y deja la nueva`, async () => {
      const u = await createTestUser(app.prisma, orgId, role, PASS);
      const first = await login(app, u.email);
      expect((await ping(app, first.token)).statusCode).toBe(200);

      const second = await login(app, u.email);

      const old = await ping(app, first.token);
      expect(old.statusCode).toBe(401);
      expect(old.json().code).toBe('SESSION_REPLACED');
      expect((await ping(app, second.token)).statusCode).toBe(200);
    });
  }

  it('el refresh de la sesión anterior falla y NO tumba a la sesión nueva', async () => {
    const u = await createTestUser(app.prisma, orgId, 'admin', PASS);
    const first = await login(app, u.email);
    const second = await login(app, u.email);

    const oldRefresh = await refresh(app, first.rf);
    expect(oldRefresh.statusCode).toBe(401);
    expect(oldRefresh.json().code).toBe('INVALID_REFRESH_TOKEN');

    // La sesión nueva sigue viva y su refresh funciona y conserva la sesión vigente.
    expect((await ping(app, second.token)).statusCode).toBe(200);
    const okRefresh = await refresh(app, second.rf);
    expect(okRefresh.statusCode).toBe(200);
    expect((await ping(app, okRefresh.json().data.accessToken)).statusCode).toBe(200);
  });

  it('renovar la sesión vigente mantiene el mismo sid (no la invalida a sí misma)', async () => {
    const u = await createTestUser(app.prisma, orgId, 'admin', PASS);
    const s = await login(app, u.email);
    const r1 = await refresh(app, s.rf);
    expect(r1.statusCode).toBe(200);
    const r2 = await refresh(app, getRfCookie(r1) as string);
    expect(r2.statusCode).toBe(200);
    expect((await ping(app, r2.json().data.accessToken)).statusCode).toBe(200);
  });

  for (const role of ['encargado', 'domiciliario'] as const) {
    it(`${role}: varias sesiones abiertas a la vez siguen funcionando`, async () => {
      const u = await createTestUser(app.prisma, orgId, role, PASS);
      const first = await login(app, u.email);
      const second = await login(app, u.email);
      expect((await ping(app, first.token)).statusCode).toBe(200);
      expect((await ping(app, second.token)).statusCode).toBe(200);
      expect((await refresh(app, first.rf)).statusCode).toBe(200);
    });
  }

  it('un token anterior a la regla (sin sid) vale mientras la cuenta no vuelva a iniciar sesión', async () => {
    const u = await createTestUser(app.prisma, orgId, 'admin', PASS);
    const legacy = app.jwt.sign({ userId: u.id, orgId, role: 'admin' }, { expiresIn: '15m' });
    expect((await ping(app, legacy)).statusCode).toBe(200);
    await login(app, u.email); // ahora hay sesión única vigente
    const after = await ping(app, legacy);
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('SESSION_REPLACED');
  });
});
