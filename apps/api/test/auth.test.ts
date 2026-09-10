import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// sendEmail hits a real external API (Resend) - mocked so the lockout-notification
// tests below never make a real network call (same pattern as auth-2fa.test.ts's
// verification-code email).
const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/email.js', () => ({ sendEmail: (...args: any[]) => sendEmailMock(...args) }));

import { buildTestServer, createTestOrg, createTestUser, getRfCookie } from './helpers.js';

describe('auth routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  const email = `auth-test-${Date.now()}@example.com`;
  const password = 'CorrectHorseBatteryStaple1!';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    await createTestUser(app.prisma, orgId, 'encargado', password, { email });
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in with correct credentials -> 200, returns accessToken + user, sets rf cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.user).toMatchObject({
      email,
      org_id: orgId,
      role: 'encargado',
      active: true,
    });

    const rfCookie = res.cookies.find((c) => c.name === 'rf');
    expect(rfCookie).toBeDefined();
    expect(rfCookie!.value.length).toBeGreaterThan(0);
    expect(rfCookie!.httpOnly).toBe(true);
    expect(rfCookie!.path).toBe('/api/v1/auth');
  });

  it('rejects login with wrong password -> 401 INVALID_CREDENTIALS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'totally-wrong-password' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login with a nonexistent email using the SAME error code (timing-attack protection)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `nobody-${Date.now()}@example.com`, password: 'whatever123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('refreshes with a valid cookie -> 200, new accessToken, cookie rotated', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const loginAccessToken = loginRes.json().data.accessToken;
    const cookie1 = getRfCookie(loginRes)!;
    expect(cookie1).toBeDefined();

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { rf: cookie1 },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });

    expect(refreshRes.statusCode).toBe(200);
    const newAccessToken = refreshRes.json().data.accessToken;
    expect(newAccessToken).toEqual(expect.any(String));
    // Note: not asserting newAccessToken !== loginAccessToken - a JWT's contents
    // (userId/orgId/role/iat/exp) are deterministic, so two tokens issued for the
    // same user within the same wall-clock second are legitimately identical.
    // The functional check below (it authenticates) plus the cookie-rotation
    // check are what actually prove refresh worked.
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${newAccessToken}` },
    });
    expect(meRes.statusCode).toBe(200);

    const cookie2 = getRfCookie(refreshRes);
    expect(cookie2).toBeDefined();
    expect(cookie2).not.toBe(cookie1);
  });

  it('detects refresh-token reuse: replaying a rotated-away cookie returns 401 TOKEN_REUSE_DETECTED and revokes the whole family', async () => {
    // Fresh login so this test doesn't depend on state left by other tests.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const cookieGen1 = getRfCookie(loginRes)!;

    // First refresh: rotates cookieGen1 -> cookieGen2. This is legitimate use.
    const refresh1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { rf: cookieGen1 },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(refresh1.statusCode).toBe(200);
    const cookieGen2 = getRfCookie(refresh1)!;
    expect(cookieGen2).toBeDefined();

    // Replay the now-rotated-away generation-1 cookie - simulates a stolen/replayed token.
    const reuseAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { rf: cookieGen1 },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(reuseAttempt.statusCode).toBe(401);
    expect(reuseAttempt.json().code).toBe('TOKEN_REUSE_DETECTED');

    // The whole session family (including the legitimately-rotated generation-2 cookie)
    // must now be revoked too - otherwise a thief racing the real user could still get in.
    const gen2NowInvalid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { rf: cookieGen2 },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(gen2NowInvalid.statusCode).toBe(401);
  });

  it('rejects refresh with no cookie -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(res.statusCode).toBe(401);
  });

  // Security-audit finding: /refresh requires this header as a CSRF defense - a
  // cross-site form/img/script can make the browser attach the `rf` cookie to a
  // forged request, but can't set a custom header without triggering a CORS
  // preflight that only the real frontend origin ever passes.
  it('rejects refresh with no X-Requested-With header -> 403 CSRF_CHECK_FAILED, even with a valid cookie', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const cookie = getRfCookie(loginRes)!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { rf: cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF_CHECK_FAILED');
  });

  it('GET /auth/me with a valid access token -> 200 with user data', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const accessToken = loginRes.json().data.accessToken;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data).toMatchObject({ email, org_id: orgId, role: 'encargado' });
  });

  it('GET /auth/me with no token -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

// Own describe block with its own org/user - a lockout deliberately affects a
// specific account for a while, so this must never share state with (or run
// interleaved against) the tests above.
describe('account lockout after repeated failed logins', () => {
  let app: FastifyInstance;
  const email = `lockout-test-${Date.now()}@example.com`;
  const password = 'CorrectHorseBatteryStaple1!';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    await createTestUser(app.prisma, org.id, 'encargado', password, { email });
  });

  afterAll(async () => {
    await app.close();
  });

  it('locks the account after 5 wrong passwords, notifies the owner by email, and rejects further attempts (even the RIGHT password) with 429 ACCOUNT_LOCKED', async () => {
    sendEmailMock.mockClear();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INVALID_CREDENTIALS');
    }

    // Security-audit finding: the account owner is notified the moment a
    // lockout actually triggers (not on every failed attempt before that).
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe(email);

    const lockedOut = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email, password }, // the CORRECT password, doesn't matter now
    });
    expect(lockedOut.statusCode).toBe(429);
    expect(lockedOut.json().code).toBe('ACCOUNT_LOCKED');
  });

  it('a correct password does NOT count as a failed attempt, even when the account\'s organization is inactive', async () => {
    const org2 = await createTestOrg(app.prisma, { active: false });
    const email2 = `lockout-inactive-org-${Date.now()}@example.com`;
    const user = await createTestUser(app.prisma, org2.id, 'encargado', password, { email: email2 });

    // Security-audit bug fix: previously `!user.org.active` was OR'd into the
    // same branch that increments failed_login_attempts, so a correct password
    // against an inactive org's account still got counted as a "failed" login.
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: email2, password },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');

    const after = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failed_login_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
  });
});
