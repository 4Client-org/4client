import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { config } from '../src/config.js';

// Direct JWT signing (same pattern as cierre.test.ts's orgWithDirectToken) -
// skips the real, rate-limited /auth/login route entirely since this file
// needs several tokens per test (different roles, cross-org).
async function directToken(app: FastifyInstance, orgId: string, userId: string, role: string) {
  return app.jwt.sign({ userId, orgId, role }, { expiresIn: '15m' });
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

function groqBody(items: unknown) {
  return { choices: [{ message: { content: JSON.stringify({ items }) } }] };
}

describe('POST /inbox/:ticketId/parse-messages ("Tomar lista")', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let encargadoToken: string;
  let domiciliarioToken: string;
  let ticketId: string;
  let inMsgId: string;
  let inMsgId2: string;
  let outMsgId: string;
  let mediaMsgId: string;
  let otherOrgMsgId: string;

  beforeAll(async () => {
    app = await buildTestServer();

    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'unused-not-logged-in-1!');
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', 'unused-not-logged-in-1!');
    const domiciliario = await createTestUser(app.prisma, orgId, 'domiciliario', 'unused-not-logged-in-1!');
    adminToken = await directToken(app, orgId, admin.id, 'admin');
    encargadoToken = await directToken(app, orgId, encargado.id, 'encargado');
    domiciliarioToken = await directToken(app, orgId, domiciliario.id, 'domiciliario');

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573005550001', customer_name: 'Cliente Tomar Lista' },
    });
    ticketId = ticket.id;

    const inMsg = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'in', text: 'quiero un tomate' },
    });
    inMsgId = inMsg.id;
    const inMsg2 = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'in', text: 'y una cebolla malla', created_at: new Date(Date.now() + 1000) },
    });
    inMsgId2 = inMsg2.id;
    const outMsg = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'out', text: 'Con gusto!' },
    });
    outMsgId = outMsg.id;
    const mediaMsg = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'in', media_type: 'image', media_url: 'https://example.com/x.jpg' },
    });
    mediaMsgId = mediaMsg.id;

    await app.prisma.product.create({ data: { org_id: orgId, name: 'Tomate', price_per_unit: 3000 } });
    await app.prisma.product.create({ data: { org_id: orgId, name: 'Papa criolla', price_per_unit: 4000, active: false } });

    const otherOrg = await createTestOrg(app.prisma);
    const otherTicket = await app.prisma.ticket.create({ data: { org_id: otherOrg.id, phone: '573005550099', customer_name: 'Otra Org' } });
    const otherMsg = await app.prisma.ticketMessage.create({ data: { ticket_id: otherTicket.id, direction: 'in', text: 'hola' } });
    otherOrgMsgId = otherMsg.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    delete (config as any).GROQ_API_KEY;
    delete (config as any).CEREBRAS_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (config as any).GROQ_API_KEY;
  });

  it('happy path: matched item gets the catalog price, unmatched item is flagged for review, never touches the DB', async () => {
    (config as any).GROQ_API_KEY = 'test-key';
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      json: async () => groqBody([
        { product_name: 'tomate', quantity_label: '1 kg' },
        { product_name: 'cebolla malla', quantity_label: '' },
      ]),
    } as Response);

    const beforeOrders = await app.prisma.order.count({ where: { org_id: orgId } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(encargadoToken),
      payload: { messageIds: [inMsgId, inMsgId2] },
    });

    expect(res.statusCode).toBe(200);
    const { items, unmatchedNames } = res.json().data;
    expect(items).toEqual([
      { product_name: 'Tomate', quantity_label: '1 kg', price: 3000, added_by_client: false, ai_unmatched: false },
      { product_name: 'cebolla malla', quantity_label: '', price: 0, added_by_client: false, ai_unmatched: true },
    ]);
    expect(unmatchedNames).toEqual(['cebolla malla']);

    const afterOrders = await app.prisma.order.count({ where: { org_id: orgId } });
    expect(afterOrders).toBe(beforeOrders);
  });

  it('rejects if any selected message is media', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(encargadoToken),
      payload: { messageIds: [inMsgId, mediaMsgId] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects if any selected message is outbound (staff reply)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(encargadoToken),
      payload: { messageIds: [inMsgId, outMsgId] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a message id belonging to another org/ticket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(encargadoToken),
      payload: { messageIds: [inMsgId, otherOrgMsgId] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('all configured providers failing -> 502 AI_EXTRACTION_FAILED', async () => {
    (config as any).GROQ_API_KEY = 'test-key';
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as Response);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(encargadoToken),
      payload: { messageIds: [inMsgId] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('AI_EXTRACTION_FAILED');
  });

  it('role gate: admin and encargado allowed, domiciliario forbidden', async () => {
    (config as any).GROQ_API_KEY = 'test-key';
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      json: async () => groqBody([{ product_name: 'tomate', quantity_label: '' }]),
    } as Response);

    const admin = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(adminToken), payload: { messageIds: [inMsgId] },
    });
    expect(admin.statusCode).toBe(200);

    const domiciliario = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticketId}/parse-messages`,
      headers: authHeader(domiciliarioToken), payload: { messageIds: [inMsgId] },
    });
    expect(domiciliario.statusCode).toBe(403);
  });
});
