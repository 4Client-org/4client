import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'InboxTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('inbox routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminId = admin.id;
    adminToken = await login(app, admin.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /:ticketId/messages?fecha=X only returns that day\'s order, not every order this ticket ever had', async () => {
    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573009990001', customer_name: 'Cliente Multi Dia' },
    });

    const orderYesterday = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Multi Dia',
        address: 'Calle 1', payment_method: 'cash', registered_by: adminId, fecha: new Date('2026-01-10'),
      },
    });
    const orderToday = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Multi Dia',
        address: 'Calle 2', payment_method: 'cash', registered_by: adminId, fecha: new Date('2026-01-11'),
      },
    });

    const today = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages?fecha=2026-01-11`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(today.statusCode).toBe(200);
    const todayOrderIds = today.json().data.orders.map((o: any) => o.id);
    expect(todayOrderIds).toEqual([orderToday.id]);
    expect(todayOrderIds).not.toContain(orderYesterday.id);

    const yesterday = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages?fecha=2026-01-10`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const yesterdayOrderIds = yesterday.json().data.orders.map((o: any) => o.id);
    expect(yesterdayOrderIds).toEqual([orderYesterday.id]);

    // No fecha given (older/other callers) - unscoped, backward-compatible: both show.
    const unscoped = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const unscopedIds = unscoped.json().data.orders.map((o: any) => o.id);
    expect(unscopedIds.sort()).toEqual([orderToday.id, orderYesterday.id].sort());
  });
});

describe('inbox routes - Meta WhatsApp delivery tracking', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    // No WPP_TOKEN_ENC_KEY in the test env (.env.test) - crypto.ts's encryptSecret/
    // decryptSecret treat an unprefixed value as legacy plaintext, so a plain string
    // round-trips fine here without needing real encryption for this test.
    await app.prisma.organization.update({
      where: { id: orgId },
      data: { wpp_meta_phone_id: 'test-phone-id', wpp_meta_token: 'test-token' },
    });
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'InboxWppAdmin1!');
    adminToken = await login(app, admin.email, 'InboxWppAdmin1!');
    originalFetch = global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  it('POST /:ticketId/reply stores the real Meta message id - webhook.ts\'s ingestStatus can only ever match a later delivered/read status to this message by it', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230001', customer_name: 'Cliente WPP OK' } });
    // Unique per test run, not a fixed literal - wpp_message_id is globally unique,
    // and a hardcoded value would collide with a leftover row from a previous run
    // against the same (not wiped between runs) test database.
    const fakeWamid = `wamid.TESTOK${Date.now()}`;
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: fakeWamid }] }), { status: 200 })) as any;

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/reply`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'Hola, tu pedido va en camino' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().wpp_status).toBe('sent');

    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: res.json().data.id } });
    expect(stored!.wpp_message_id).toBe(fakeWamid);
    expect(stored!.failed_reason).toBeNull();
  });

  it('POST /:ticketId/reply broadcasts ticket:message-status on a SUCCESSFUL send too, not just on failure - otherwise a chat already open on someone\'s screen never learns wpp_message_id is set and DeliveryStatus.tsx (gated on that) stays invisible until an unrelated refetch happens to catch up', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230003', customer_name: 'Cliente WPP Socket' } });
    const fakeWamid = `wamid.SOCKETOK${Date.now()}`;
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: fakeWamid }] }), { status: 200 })) as any;

    const emitSpy = vi.fn();
    const toSpy = vi.spyOn(app.io, 'to').mockReturnValue({ emit: emitSpy } as any);

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/reply`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'Confirmando tu pedido' },
    });
    expect(res.statusCode).toBe(201);

    const statusEmitCall = emitSpy.mock.calls.find(call => call[0] === 'ticket:message-status');
    expect(statusEmitCall).toBeDefined();
    expect(statusEmitCall![1]).toMatchObject({ ticketId: ticket.id, messageId: res.json().data.id, delivered: false, read_by_client: false, failed_reason: null });

    toSpy.mockRestore();
  });

  it('POST /:ticketId/reply records failed_reason when Meta rejects the send (e.g. no active 24h session and no approved template) - shows the red X instead of looking stuck forever', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230002', customer_name: 'Cliente WPP Fail' } });
    global.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Re-engagement message' } }), { status: 400 })) as any;

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/reply`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'Hola de nuevo' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().wpp_status).toBe('failed');

    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: res.json().data.id } });
    expect(stored!.wpp_message_id).toBeNull();
    expect(stored!.failed_reason).toContain('Re-engagement');
  });
});
