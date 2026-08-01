import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'TicketsTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('GET /tickets ordering', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  // Real production bug: a ticket is one row per phone forever, so an old
  // customer's `created_at` is from whenever they FIRST ever wrote (weeks ago),
  // not from today. Sorting by created_at put them ahead of every genuinely new
  // conversation today regardless of when they actually wrote today - the fix is
  // ordering by last_message_at (updated on every inbound/outbound message)
  // instead, so the board reflects TODAY's actual timeline.
  it('a returning customer (old created_at, fresh last_message_at) sorts by when they last wrote TODAY, not by when their ticket was first created', async () => {
    const today = new Date(new Date().toISOString().split('T')[0]);

    const oldTicket = await app.prisma.ticket.create({
      data: {
        org_id: orgId, phone: '573001110001', customer_name: 'Cliente Antiguo',
        fecha: today,
        created_at: new Date('2020-01-01T00:00:00Z'), // ticket first opened years ago
        last_message_at: new Date(), // but wrote again just now
      },
    });
    const newTicket = await app.prisma.ticket.create({
      data: {
        org_id: orgId, phone: '573001110002', customer_name: 'Cliente Nuevo',
        fecha: today,
        last_message_at: new Date(Date.now() - 60_000), // wrote a minute earlier than the old customer
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tickets?fecha=${today.toISOString().split('T')[0]}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((t: any) => t.id);

    // newTicket wrote FIRST (earlier last_message_at) so it must come first -
    // oldTicket's ancient created_at must have zero influence on the order.
    expect(ids.indexOf(newTicket.id)).toBeLessThan(ids.indexOf(oldTicket.id));
  });
});
