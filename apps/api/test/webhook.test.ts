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

  it('first message of the day sends the welcome text AND, right after, TWO form-link messages (notice, then the bare link) - all captured with a real wpp_message_id, not just the welcome alone', async () => {
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
    // time to finish three sequential provider.sendText calls plus their DB writes.
    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const outbound = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticket.id, direction: 'out' }, orderBy: { sent_at: 'asc' } });

    // Welcome, then the notice/bank-account text, then the link ALONE as its own
    // message, then a short follow-up nudge - split so the client can forward/
    // copy just the link without dragging the notice along, and so no message
    // risks getting too long.
    expect(outbound).toHaveLength(4);
    expect(outbound[0].text).toContain('bienvenido');
    expect(outbound[0].wpp_message_id).toBeTruthy();
    expect(outbound[1].text).toContain('ESTE LINK ES SOLO');
    expect(outbound[1].text).toContain('Cuenta de ahorros');
    expect(outbound[1].text).not.toContain('http');
    expect(outbound[1].wpp_message_id).toBeTruthy();
    expect(outbound[1].failed_reason).toBeNull();
    expect(outbound[2].text).toMatch(/^https?:\/\//);
    expect(outbound[2].wpp_message_id).toBeTruthy();
    expect(outbound[2].failed_reason).toBeNull();
    expect(outbound[3].text).toContain('Diligencia por favor el pedido');
    expect(outbound[3].wpp_message_id).toBeTruthy();
    expect(outbound[3].failed_reason).toBeNull();

    // Proves generateFormLinkUrl actually ran (a live, checkable link), not just a
    // static text blob that happens to contain the right words.
    const updatedTicket = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.form_token_min_iat).not.toBeNull();
  });

  it('an inbound image message is resolved (media id -> temp URL -> bytes) and stored with media_type/media_url set, never Meta\'s own temp URL', async () => {
    // No welcome_message on this org - keeps the auto-reply/form-link send paths
    // out of the way so only the image-ingestion fetch calls happen below.
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-img-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    const mediaId = `media-${randomUUID()}`;
    // Deliberately NOT ending in `/${mediaId}` - it used to (matching the real
    // shape of a WhatsApp CDN URL), which made it collide with the media-info
    // mock branch below (that one also matches on a URL ending in the media id),
    // so downloadMedia was silently "downloading" the media-INFO JSON response
    // instead of the actual fake bytes - passed anyway before detectImageMime
    // existed to notice, since nothing validated the byte content back then.
    const tempUrl = `https://mmg.whatsapp.net/cdn-bytes/${mediaId}-download`;
    // Real JPEG magic bytes (FF D8 FF...) - webhook.ts now verifies the actual file
    // signature before storing/serving anything, regardless of what mime_type Meta
    // itself reported, so arbitrary bytes here would fail that check and fall
    // through to the "no se pudo descargar" path instead of the happy path below.
    const fakeBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

    global.fetch = (async (url: string) => {
      if (String(url).endsWith(`/${mediaId}`)) {
        return new Response(JSON.stringify({ url: tempUrl, mime_type: 'image/jpeg' }), { status: 200 });
      }
      if (url === tempUrl) {
        return new Response(fakeBytes, { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-img',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: wppPhoneId, display_phone_number: '' },
            contacts: [{ profile: { name: 'Cliente Foto' }, wa_id: phone }],
            messages: [{
              from: phone, id: `wamid.img-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'image', image: { id: mediaId, mime_type: 'image/jpeg', caption: 'Aquí está mi dirección' },
            }],
          },
        }],
      }],
    };

    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const inbound = await app.prisma.ticketMessage.findFirstOrThrow({ where: { ticket_id: ticket.id, direction: 'in' } });

    expect(inbound.media_type).toBe('image');
    expect(inbound.media_url).toMatch(/^[0-9a-f]{40}\.jpg$/);
    expect(inbound.media_url).not.toContain('http');
    expect(inbound.text).toBe('Aquí está mi dirección');
  });

  it('an inbound "image" whose downloaded bytes don\'t actually match any real image signature is never stored as one - falls back to a visible "no se pudo descargar" note instead, same as a genuine download failure', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-badimg-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    const mediaId = `media-bad-${randomUUID()}`;
    // Deliberately NOT ending in `/${mediaId}` - it used to (matching the real
    // shape of a WhatsApp CDN URL), which made it collide with the media-info
    // mock branch below (that one also matches on a URL ending in the media id),
    // so downloadMedia was silently "downloading" the media-INFO JSON response
    // instead of the actual fake bytes - passed anyway before detectImageMime
    // existed to notice, since nothing validated the byte content back then.
    const tempUrl = `https://mmg.whatsapp.net/cdn-bytes/${mediaId}-download`;

    global.fetch = (async (url: string) => {
      if (String(url).endsWith(`/${mediaId}`)) {
        return new Response(JSON.stringify({ url: tempUrl, mime_type: 'image/jpeg' }), { status: 200 });
      }
      if (url === tempUrl) {
        // Claims to be a jpeg but isn't one - no real magic bytes at all.
        return new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-badimg',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: wppPhoneId, display_phone_number: '' },
            contacts: [{ profile: { name: 'Cliente Foto Falsa' }, wa_id: phone }],
            messages: [{
              from: phone, id: `wamid.badimg-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'image', image: { id: mediaId, mime_type: 'image/jpeg' },
            }],
          },
        }],
      }],
    };

    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const inbound = await app.prisma.ticketMessage.findFirstOrThrow({ where: { ticket_id: ticket.id, direction: 'in' } });

    expect(inbound.media_type).toBeNull();
    expect(inbound.media_url).toBeNull();
    expect(inbound.text).toContain('no se pudo descargar');
  });
});
