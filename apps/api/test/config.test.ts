import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'ConfigTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// wpp_meta_phone_id is @unique at the DB level (security-audit fix) - without
// it, one org's admin setting their own phone id to another org's real value
// would silently start routing that other org's customer WhatsApp messages
// here instead. This exercises that the constraint actually holds and that
// PATCH /config/wpp surfaces it as a clear conflict, not a raw 500.
describe('PATCH /config/wpp - wpp_meta_phone_id uniqueness', () => {
  let app: FastifyInstance;
  let orgAId: string;
  let orgBId: string;
  let adminAToken: string;
  let adminBToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const orgA = await createTestOrg(app.prisma);
    orgAId = orgA.id;
    const orgB = await createTestOrg(app.prisma);
    orgBId = orgB.id;

    const adminA = await createTestUser(app.prisma, orgAId, 'admin', ADMIN_PASS, { email: `config-admin-a-${orgAId}@example.com` });
    adminAToken = await login(app, adminA.email, ADMIN_PASS);
    const adminB = await createTestUser(app.prisma, orgBId, 'admin', ADMIN_PASS, { email: `config-admin-b-${orgBId}@example.com` });
    adminBToken = await login(app, adminB.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an org claim a wpp_meta_phone_id nobody else has', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/v1/config/wpp',
      headers: { authorization: `Bearer ${adminAToken}` },
      payload: { wpp_meta_phone_id: `unique-phone-${orgAId}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.wpp_meta_phone_id).toBe(`unique-phone-${orgAId}`);
  });

  it('rejects a second org claiming the SAME wpp_meta_phone_id with 409 PHONE_ID_ALREADY_IN_USE, not a raw 500', async () => {
    const shared = `contested-phone-${orgAId}`;
    const first = await app.inject({
      method: 'PATCH', url: '/api/v1/config/wpp',
      headers: { authorization: `Bearer ${adminAToken}` },
      payload: { wpp_meta_phone_id: shared },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PATCH', url: '/api/v1/config/wpp',
      headers: { authorization: `Bearer ${adminBToken}` },
      payload: { wpp_meta_phone_id: shared },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('PHONE_ID_ALREADY_IN_USE');

    // Org B's own phone id must be untouched by the failed attempt.
    const orgB = await app.prisma.organization.findUniqueOrThrow({ where: { id: orgBId } });
    expect(orgB.wpp_meta_phone_id).not.toBe(shared);
  });
});
