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

  it('first message of the day sends welcome+notice combined into ONE message, then the bare link, then the follow-up nudge - three messages total, all captured with a real wpp_message_id', async () => {
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

    // Welcome+notice combined into ONE message, then the link ALONE as its own
    // message (so the client can forward/copy just the link), then a short
    // follow-up nudge.
    expect(outbound).toHaveLength(3);
    expect(outbound[0].text).toContain('bienvenido');
    expect(outbound[0].text).toContain('solo para hacer tu pedido');
    expect(outbound[0].text).toContain('Ahorros Bancolombia');
    // Ley 1581 de 2012 - el aviso de privacidad va pegado al final de ESTE mismo
    // mensaje (buildPrivacyNoticeMessage), no del link del pedido - por eso SÍ
    // lleva una URL (la de la política, no la del formulario) y eso es a propósito.
    expect(outbound[0].text).toContain('política de privacidad');
    expect(outbound[0].text).toContain('politica-privacidad.html');
    expect(outbound[0].wpp_message_id).toBeTruthy();
    expect(outbound[0].failed_reason).toBeNull();
    // El link del PEDIDO sigue siendo el único contenido de este segundo mensaje -
    // nada del aviso de privacidad se mezcla acá, para que el cliente pueda
    // reenviar/copiar solo el link.
    expect(outbound[1].text).toMatch(/^https?:\/\//);
    expect(outbound[1].text).not.toContain('politica-privacidad');
    expect(outbound[1].wpp_message_id).toBeTruthy();
    expect(outbound[1].failed_reason).toBeNull();
    expect(outbound[2].text).toContain('Diligencia por favor el pedido');
    expect(outbound[2].wpp_message_id).toBeTruthy();
    expect(outbound[2].failed_reason).toBeNull();

    // Proves generateFormLinkUrl actually ran (a live, checkable link), not just a
    // static text blob that happens to contain the right words.
    const updatedTicket = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.form_token_min_iat).not.toBeNull();
  });

  it('org.wpp_redirect_message set -> sends ONLY that text, never the welcome/link/follow-up flow, even when welcome_message is also set', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: {
        // Both set on purpose - redirect must win over the normal welcome flow.
        welcome_message: 'Hola, bienvenido a Fruver San Gabriel',
        wpp_redirect_message: '⚠️ Este número cambió. Escríbenos al nuevo: +57 302 4100351 para tu domicilio.',
        wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token',
      },
    });

    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `wamid.auto-${randomUUID()}` }] }), { status: 200 })) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: messagePayload(wppPhoneId, phone, 'Hola', `wamid.in-${randomUUID()}`),
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const outbound = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticket.id, direction: 'out' }, orderBy: { sent_at: 'asc' } });

    // Exactly ONE outbound message - never the 3-message welcome/link/follow-up.
    expect(outbound).toHaveLength(1);
    expect(outbound[0].text).toBe('⚠️ Este número cambió. Escríbenos al nuevo: +57 302 4100351 para tu domicilio.');
    expect(outbound[0].text).not.toContain('bienvenido');
    expect(outbound[0].text).not.toMatch(/https?:\/\//);
    expect(outbound[0].wpp_message_id).toBeTruthy();
    expect(outbound[0].failed_reason).toBeNull();

    // Never generated a form link for this ticket - proves the whole form-link
    // branch was skipped, not just that its messages happen not to show up.
    const updatedTicket = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updatedTicket.form_token_min_iat).toBeNull();
  });

  // Confirmed-real Meta glitch (not a hypothetical): a message arrived once with
  // msg.from empty while the rest of the payload (contacts[] profile name, text)
  // was intact - the resulting ticket was reachable by nobody (every automated
  // send failed against Meta with "the parameter to is required"), and there was
  // no raw payload saved anywhere to even confirm what Meta actually sent.
  it('a message with an empty sender phone (msg.from = "") gets a unique placeholder phone, is flagged no_wpp_number, and never attempts the welcome/link auto-send', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { welcome_message: 'Hola, bienvenido a Fruver San Gabriel', wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    let metaCalled = false;
    global.fetch = (async () => { metaCalled = true; return new Response(JSON.stringify({ messages: [{ id: 'unused' }] }), { status: 200 }); }) as any;

    const waMsgId = `wamid.in-${randomUUID()}`;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: messagePayload(wppPhoneId, '', 'Hola para pedir un domicilio', waMsgId),
    });
    expect(res.statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 300));

    const message = await app.prisma.ticketMessage.findUniqueOrThrow({
      where: { wpp_message_id: waMsgId },
      include: { ticket: true },
    });
    expect(message.ticket.no_wpp_number).toBe(true);
    // Unique, never the empty string that would collide with a later ghost ticket
    // under the same org (@@unique([org_id, phone])).
    expect(message.ticket.phone).toMatch(/^no-[0-9a-f]{16}$/);

    // No welcome, no form-link sequence, no failed_reason rows - the customer's
    // own message is the ONLY row on this ticket, and Meta's API was never called.
    const allMessages = await app.prisma.ticketMessage.findMany({ where: { ticket_id: message.ticket.id } });
    expect(allMessages).toHaveLength(1);
    expect(metaCalled).toBe(false);
  });

  // The whole point of raw_payload: Railway's own log retention turned out too
  // short to catch this exact glitch after the fact (confirmed live) - the
  // database is now the only durable place to see what Meta actually sent.
  it('every inbound message persists the ENTIRE webhook POST body verbatim in raw_payload - on the message always, and on the ticket only at creation time', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-raw-${randomUUID()}`;
    await app.prisma.organization.update({ where: { id: org.id }, data: { wpp_meta_phone_id: wppPhoneId } });

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const waMsgId1 = `wamid.raw1-${randomUUID()}`;
    const firstPayload = messagePayload(wppPhoneId, phone, 'Primer mensaje', waMsgId1);

    const res1 = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: firstPayload,
    });
    expect(res1.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const msg1 = await app.prisma.ticketMessage.findUniqueOrThrow({ where: { wpp_message_id: waMsgId1 } });
    // Both should hold the exact same payload that created the ticket.
    expect(ticket.raw_payload).toEqual(firstPayload);
    expect(msg1.raw_payload).toEqual(firstPayload);

    // A SECOND message on the same (now-existing) ticket - its own raw_payload
    // must be captured too, but the TICKET's founding raw_payload must NOT be
    // overwritten by this later, different payload.
    const waMsgId2 = `wamid.raw2-${randomUUID()}`;
    const secondPayload = messagePayload(wppPhoneId, phone, 'Segundo mensaje', waMsgId2);
    const res2 = await app.inject({
      method: 'POST', url: '/api/v1/webhook',
      headers: { 'content-type': 'application/json' },
      payload: secondPayload,
    });
    expect(res2.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const msg2 = await app.prisma.ticketMessage.findUniqueOrThrow({ where: { wpp_message_id: waMsgId2 } });
    expect(msg2.raw_payload).toEqual(secondPayload);

    const ticketAfter = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfter.raw_payload).toEqual(firstPayload); // unchanged, still the founding one
  });

  // Exact shape captured live from production raw_payload (WhatsApp usernames /
  // BSUID rollout, June 2026) - confirmed via Meta's own docs that `from`/`wa_id`
  // can be omitted entirely once a contact enables a username, replaced by
  // from_user_id/user_id instead. This must NOT be treated as the "no phone at
  // all" glitch (no_wpp_number) - the customer IS reachable, just via this
  // different identifier.
  it('a message with no `from`/`wa_id` at all, only from_user_id/user_id (WhatsApp username/BSUID), is NOT flagged no_wpp_number - the BSUID becomes the ticket\'s phone, and replies go out via Meta\'s `recipient` field instead of `to`', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-bsuid-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { welcome_message: 'Hola, bienvenido', wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    const bsuid = 'CO.919210307886008';
    const capturedBodies: any[] = [];
    global.fetch = (async (_url: string, opts?: any) => {
      if (opts?.body) capturedBodies.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out-${randomUUID()}` }] }), { status: 200 });
    }) as any;

    const waMsgId = `wamid.bsuid-${randomUUID()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-bsuid',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: wppPhoneId, display_phone_number: '573042752444' },
            contacts: [{ profile: { name: ',,✨✨', username: 'iris.05.22' }, user_id: bsuid }],
            messages: [{
              from_user_id: bsuid, id: waMsgId, timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text', text: { body: 'Hola buenos días' },
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

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone: bsuid } });
    expect(ticket.no_wpp_number).toBe(false);
    expect(ticket.raw_payload).toEqual(payload);

    // The auto-welcome fired (org has welcome_message) - confirm the outbound
    // Meta API call used `recipient`, never `to`, for this BSUID.
    expect(capturedBodies.length).toBeGreaterThan(0);
    for (const body of capturedBodies) {
      expect(body.recipient).toBe(bsuid);
      expect(body.to).toBeUndefined();
    }
  });

  it('an inbound image message stores Meta\'s own media_id directly as media_url - nothing is downloaded from Meta at ingest time anymore (moved to inbox.ts\'s GET /media/:id, at view time - see that file\'s own tests for the byte-signature check)', async () => {
    // No welcome_message on this org - keeps the auto-reply/form-link send paths
    // out of the way so only the image-ingestion path runs below.
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-img-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    const mediaId = `media-${randomUUID()}`;
    // Ningún fetch debería dispararse al ingresar el mensaje - si el ingest
    // todavía intentara resolver/descargar la imagen, este mock lo notaría.
    global.fetch = (async (url: string) => {
      throw new Error(`unexpected fetch in test - una imagen entrante ya no se descarga al ingresar: ${url}`);
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
    expect(inbound.media_url).toBe(mediaId);
    expect(inbound.media_url).not.toContain('http');
    expect(inbound.text).toBe('Aquí está mi dirección');
  });

  it('an inbound voice note (audio/ogg) stores Meta\'s own media_id directly as media_url - nothing downloaded at ingest time, same as image', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-audio-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    const mediaId = `media-audio-${randomUUID()}`;
    global.fetch = (async (url: string) => {
      throw new Error(`unexpected fetch in test - un audio entrante ya no se descarga al ingresar: ${url}`);
    }) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-audio',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: wppPhoneId, display_phone_number: '' },
            contacts: [{ profile: { name: 'Cliente Audio' }, wa_id: phone }],
            messages: [{
              from: phone, id: `wamid.audio-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus' },
            }],
          },
        }],
      }],
    };

    const res = await app.inject({ method: 'POST', url: '/api/v1/webhook', headers: { 'content-type': 'application/json' }, payload });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 500));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const inbound = await app.prisma.ticketMessage.findFirstOrThrow({ where: { ticket_id: ticket.id, direction: 'in' } });
    expect(inbound.media_type).toBe('audio');
    expect(inbound.media_url).toBe(mediaId);
  });

  it('an inbound location never touches Meta\'s media API at all - stored directly from the coordinates in the webhook payload', async () => {
    const org = await createTestOrg(app.prisma);
    const wppPhoneId = `test-phone-loc-${randomUUID()}`;
    await app.prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_phone_id: wppPhoneId, wpp_meta_token: 'test-token' },
    });

    let metaCalled = false;
    global.fetch = (async () => { metaCalled = true; return new Response('{}', { status: 200 }); }) as any;

    const phone = `573001129${Math.floor(Math.random() * 1000)}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-loc',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: wppPhoneId, display_phone_number: '' },
            contacts: [{ profile: { name: 'Cliente Ubicacion' }, wa_id: phone }],
            messages: [{
              from: phone, id: `wamid.loc-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'location', location: { latitude: 4.6097, longitude: -74.0817, name: 'Casa' },
            }],
          },
        }],
      }],
    };

    const res = await app.inject({ method: 'POST', url: '/api/v1/webhook', headers: { 'content-type': 'application/json' }, payload });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300));

    const ticket = await app.prisma.ticket.findFirstOrThrow({ where: { org_id: org.id, phone } });
    const inbound = await app.prisma.ticketMessage.findFirstOrThrow({ where: { ticket_id: ticket.id, direction: 'in' } });
    expect(inbound.media_type).toBe('location');
    expect(inbound.media_url).toBe('https://maps.google.com/?q=4.6097,-74.0817');
    expect(inbound.text).toContain('Casa');
    expect(metaCalled).toBe(false);
  });
});
