// 2FA is gated by TWO conditions, both must pass: config.REQUIRE_2FA (env var,
// per-environment) AND role === 'dev' (per-user - only the single 'dev' role
// account, not an org-wide rollout).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// sendEmail hits a real external API (Resend) - mocked so this test never makes
// a real network call (would also fail outright: RESEND_API_KEY isn't set in
// the test environment either). The captured `html` arg is how the plaintext
// code gets recovered for the "verify with the right code" test below - it's
// only ever stored hashed in the DB.
const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/email.js', () => ({ sendEmail: (...args: any[]) => sendEmailMock(...args) }));

// Must be set BEFORE helpers.js (which pulls in config.ts transitively) is
// ever imported/evaluated - config.ts parses process.env once, at module
// load time. A plain top-level `process.env.REQUIRE_2FA = 'true'` above a
// static `import ... from './helpers.js'` does NOT work here: ES module
// imports are hoisted and fully evaluated before any of THIS file's own
// top-level statements run, regardless of source order - so config.ts would
// already have parsed (and cached) REQUIRE_2FA as unset by the time that
// assignment executed. A dynamic import sidesteps the hoisting entirely.
// Vitest still gives this file its own fresh module registry, so this only
// affects this file's env, not the rest of the suite (vitest.config.ts's
// shared `test.env` leaves REQUIRE_2FA unset/false everywhere else).
process.env.REQUIRE_2FA = 'true';
const { buildTestServer, createTestOrg, createTestUser } = await import('./helpers.js');

function extractCode(html: string): string {
  const m = html.match(/(\d{6})/);
  if (!m) throw new Error('No 6-digit code found in mocked email HTML: ' + html);
  return m[1];
}

describe('2FA login gate - scoped to the "dev" role only, even with REQUIRE_2FA on', () => {
  let app: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin logs in directly, no 2FA prompt at all, even though REQUIRE_2FA is on', async () => {
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'Admin2FAPass1!');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: admin.email, password: 'Admin2FAPass1!' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
    expect(res.json().data.pending2fa).toBeUndefined();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('encargado also logs in directly - the role gate is specifically "dev", not "everyone except admin"', async () => {
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', 'Enc2FAPass1!');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: encargado.email, password: 'Enc2FAPass1!' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
  });

  it('a "dev" role user gets pending2fa instead of a session, and a code email fires', async () => {
    const devUser = await createTestUser(app.prisma, orgId, 'dev', 'Dev2FAPass1!');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: devUser.email, password: 'Dev2FAPass1!' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pending2fa).toBe(true);
    expect(res.json().data.userId).toBe(devUser.id);
    expect(res.json().data.accessToken).toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalledWith(devUser.email, expect.any(String), expect.any(String));

    const stored = await app.prisma.loginVerificationCode.findFirst({ where: { user_id: devUser.id } });
    expect(stored).not.toBeNull();
    expect(stored!.consumed).toBe(false);
  });

  it('verify-code with the real code issues a real session and consumes the code', async () => {
    sendEmailMock.mockClear();
    const devUser = await createTestUser(app.prisma, orgId, 'dev', 'Dev2FAPass2!');
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: devUser.email, password: 'Dev2FAPass2!' } });
    const code = extractCode(sendEmailMock.mock.calls[0][2]);

    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/login/verify-code', payload: { userId: devUser.id, code } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.accessToken).toBeTruthy();
    expect(verify.json().data.user.id).toBe(devUser.id);

    const stored = await app.prisma.loginVerificationCode.findFirst({ where: { user_id: devUser.id }, orderBy: { created_at: 'desc' } });
    expect(stored!.consumed).toBe(true);
  });

  it('verify-code with the wrong code is rejected and does not issue a session', async () => {
    sendEmailMock.mockClear();
    const devUser = await createTestUser(app.prisma, orgId, 'dev', 'Dev2FAPass3!');
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: devUser.email, password: 'Dev2FAPass3!' } });

    const wrongCode = extractCode(sendEmailMock.mock.calls[0][2]) === '000000' ? '111111' : '000000';
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/login/verify-code', payload: { userId: devUser.id, code: wrongCode } });
    expect(verify.statusCode).toBe(401);
    expect(verify.json().code).toBe('INVALID_CODE');
  });
});
