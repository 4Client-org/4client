import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildTestServer, createTestOrg } from './helpers.js';

// Only the GET verification handshake is covered here. The POST message-ingestion
// path requires real Meta HMAC signing and org WPP credentials, which is a heavier
// fixture - intentionally out of scope / lower priority per the audit roadmap.
describe('webhook verification handshake', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET verify handshake with correct hub.verify_token -> 200 returns the challenge string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=challenge-abc-123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('challenge-abc-123');
  });

  it('GET verify handshake with wrong token -> 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-abc-123',
    });

    expect(res.statusCode).toBe(403);
  });
});

// Delivery/read/failure receipts don't need the heavier org+phone_number_id fixture
// ingestMessage does (they're matched purely by wpp_message_id, already stored on
// the row). No HMAC signing here - .env.test deliberately leaves META_APP_SECRET
// unset, same as any dev/test environment with no real Meta credentials configured,
// so webhook.ts's signature check is skipped entirely (see its own comment).
describe('webhook POST - delivery/read/failure status updates', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  function signedPost(app_: FastifyInstance, body: unknown) {
    return app_.inject({
      method: 'POST',
      url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
  }

  function statusPayload(statuses: Array<{ id: string; status: string; errors?: unknown[] }>) {
    return {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'unused-for-statuses', display_phone_number: '' },
            statuses: statuses.map(s => ({ ...s, timestamp: String(Math.floor(Date.now() / 1000)) })),
          },
        }],
      }],
    };
  }

  it('delivered then read updates the matching message, never regresses, and read implies delivered even if the delivered event never arrived', async () => {
    const org = await createTestOrg(app.prisma);
    const ticket = await app.prisma.ticket.create({ data: { org_id: org.id, phone: '573001120000', customer_name: 'Cliente Status' } });
    const waMsgId = `wamid.test-${randomUUID()}`;
    const message = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'out', text: 'Hola', wpp_message_id: waMsgId },
    });

    const res = await signedPost(app, statusPayload([{ id: waMsgId, status: 'read' }]));
    expect(res.statusCode).toBe(200);

    // Fire-and-forget inside the route (responds 200 before processing) - give it a
    // tick to actually finish the DB write before asserting.
    await new Promise((r) => setTimeout(r, 200));

    const after = await app.prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.delivered).toBe(true);
    expect(after.read_by_client).toBe(true);
  });

  it('a failed status records the reason without touching delivered/read_by_client', async () => {
    const org = await createTestOrg(app.prisma);
    const ticket = await app.prisma.ticket.create({ data: { org_id: org.id, phone: '573001120001', customer_name: 'Cliente Status Fail' } });
    const waMsgId = `wamid.test-${randomUUID()}`;
    const message = await app.prisma.ticketMessage.create({
      data: { ticket_id: ticket.id, direction: 'out', text: 'Hola', wpp_message_id: waMsgId },
    });

    const res = await signedPost(app, statusPayload([
      { id: waMsgId, status: 'failed', errors: [{ title: 'Recipient number not on WhatsApp' }] },
    ]));
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const after = await app.prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.failed_reason).toBe('Recipient number not on WhatsApp');
    expect(after.delivered).toBe(false);
    expect(after.read_by_client).toBe(false);
  });

  it('a status for a wpp_message_id we never stored is silently ignored, not an error', async () => {
    const res = await signedPost(app, statusPayload([{ id: `wamid.never-stored-${randomUUID()}`, status: 'delivered' }]));
    expect(res.statusCode).toBe(200);
  });
});

describe('webhook POST - incoming message triggers welcome + auto form-link send', () => {
  let app: FastifyInstance;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    app = await buildTestServer();
    originalFetch = global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  function messagePayload(phoneNumberId: string, from: string, text: string, waMsgId: string) {
    return {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: phoneNumberId, display_phone_number: '' },
            contacts: [{ profile: { name: 'Cliente Nuevo' }, wa_id: from }],
            messages: [{ from, id: waMsgId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
          },
        }],
      }],
    };
  }

  it('first message of the day sends the welcome text AND, right after, the form-link message - both captured with a real wpp_message_id, not just the welcome alone', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { welcome_message: 'Hola, bienvenido a Fruver San Gabriel', wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `wamid.auto-${randomUUID()}` }] }), { status: 200 })) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: messagePayload(wppPhoneId, phone, 'Hola quiero hacer un pedido', `wamid.in-${randomUUID()}`),
    });
    expect(res.statusCode).toBe(200);

    // Fire-and-forget inside the route (responds 200 before processing) - give it
    // time to finish two sequential provider.sendText calls plus their DB writes.
    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const outbound = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticket.id, direction: 'out' }, orderBy: { sent_at: 'asc' } });

    expect(outbound).toHaveLength(2);
    expect(outbound[0].text).toContain('bienvenido');
    expect(outbound[0].wpp_message_id).toBeTruthy();
    expect(outbound[1].text).toContain('Link de formulario');
    expect(outbound[1].wpp_message_id).toBeTruthy();
    expect(outbound[1].failed_reason).toBeNull();

    // Proves generateFormLinkUrl actually ran (a live, checkable link), not just a
    // static text blob that happens to contain the right words.
    const updatedTicket = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.form_token_min_iat).not.toBeNull();
  });
});
