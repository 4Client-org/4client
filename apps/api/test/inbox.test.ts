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

  it('the "sin leer" dot survives opening the chat any number of times - it only clears once staff actually replies', async () => {
    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573009990002', customer_name: 'Cliente Sin Leer', unread_count: 3 },
    });

    for (let i = 0; i < 3; i++) {
      const opened = await app.inject({
        method: 'GET',
        url: `/api/v1/inbox/${ticket.id}/messages`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(opened.statusCode).toBe(200);
      const stillUnread = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stillUnread.unread_count).toBe(3);
    }

    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticket.id}/reply`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'Ya te atiendo' },
    });
    expect(reply.statusCode).toBe(201);

    const afterReply = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(afterReply.unread_count).toBe(0);
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
    // The actual Meta send is now fired in the background, not awaited before
    // responding (see inbox.ts's /reply) - the HTTP response only ever reports
    // 'sending' at this point, the real outcome lands moments later via a DB
    // update + 'ticket:message-status' socket emit.
    expect(res.json().wpp_status).toBe('sending');

    await new Promise((r) => setTimeout(r, 200));
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
    // Background send (see the previous test's comment) - give it a moment to
    // actually run and emit before checking the spy.
    await new Promise((r) => setTimeout(r, 200));

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
    // Same as the success case - the HTTP response can't know the real outcome
    // anymore, it only ever reports 'sending' (see inbox.ts's /reply).
    expect(res.json().wpp_status).toBe('sending');

    await new Promise((r) => setTimeout(r, 200));
    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: res.json().data.id } });
    expect(stored!.wpp_message_id).toBeNull();
    expect(stored!.failed_reason).toContain('Re-engagement');
  });

  it('POST /:ticketId/send-image stores the photo (media_type/media_url set) and sends it via Meta\'s two-step upload-then-send, never a public URL', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230004', customer_name: 'Cliente Foto' } });
    const fakeMediaId = `media-id-${Date.now()}`;
    const fakeWamid = `wamid.IMG${Date.now()}`;

    // Two distinct Meta endpoints get hit in sequence - branch on the URL so each
    // returns the shape that specific call expects.
    global.fetch = (async (url: string) => {
      if (String(url).endsWith('/media')) {
        return new Response(JSON.stringify({ id: fakeMediaId }), { status: 200 });
      }
      return new Response(JSON.stringify({ messages: [{ id: fakeWamid }] }), { status: 200 });
    }) as any;

    // Smallest valid PNG (1x1, base64) - real bytes, not a placeholder string, so
    // storeMedia/loadMedia round-trip something genuine.
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/send-image`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPng, mime_type: 'image/png', caption: 'Así llegó el pedido' },
    });
    expect(res.statusCode).toBe(201);
    // Background upload+send (see the /reply tests' comment above) - the HTTP
    // response can't know the real Meta outcome yet.
    expect(res.json().wpp_status).toBe('sending');
    const msg = res.json().data;
    expect(msg.media_type).toBe('image');
    expect(msg.media_url).toMatch(/^[0-9a-f]{40}\.png$/);
    expect(msg.media_caption).toBe('Así llegó el pedido');

    await new Promise((r) => setTimeout(r, 200));
    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: msg.id } });
    expect(stored!.wpp_message_id).toBe(fakeWamid);
    expect(stored!.failed_reason).toBeNull();

    // The token never carries a real R2/public URL - just an opaque key, served
    // exclusively through our own staff-authenticated route.
    expect(msg.media_url).not.toContain('http');

    const fetched = await app.inject({
      method: 'GET', url: `/api/v1/inbox/media/${msg.media_url}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    // Guards against a browser sniffing/re-interpreting the bytes as something
    // other than what Content-Type says, if this URL is ever opened directly
    // instead of through the app's own fetch-as-blob rendering path.
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
  });

  it('POST /:ticketId/send-image rejects a file whose real bytes don\'t match the declared mime_type - never trusts the label alone', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230006', customer_name: 'Cliente Foto Falsa' } });

    // Plain text, not a real image, but claiming to be a PNG.
    const fakeData = Buffer.from('<script>alert(1)</script>').toString('base64');

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/send-image`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: fakeData, mime_type: 'image/png' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');

    const stored = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticket.id } });
    expect(stored).toHaveLength(0);
  });

  it('POST /:ticketId/send-audio stores and sends a voice note - no caption field at all (WhatsApp audio messages don\'t support one)', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230007', customer_name: 'Cliente Audio Saliente' } });
    const fakeMediaId = `media-id-audio-${Date.now()}`;
    const fakeWamid = `wamid.AUD${Date.now()}`;
    global.fetch = (async (url: string) => {
      if (String(url).endsWith('/media')) return new Response(JSON.stringify({ id: fakeMediaId }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: fakeWamid }] }), { status: 200 });
    }) as any;

    // Real OGG magic bytes ("OggS").
    const oggBytes = Buffer.from('OggS' + '\x00'.repeat(10)).toString('base64');

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/send-audio`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: oggBytes, mime_type: 'audio/ogg' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json().data;
    expect(msg.media_type).toBe('audio');
    expect(msg.media_url).toMatch(/^[0-9a-f]{40}\.ogg$/);

    await new Promise((r) => setTimeout(r, 200));
    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: msg.id } });
    expect(stored!.wpp_message_id).toBe(fakeWamid);
    expect(stored!.failed_reason).toBeNull();
  });

  it('POST /:ticketId/send-document stores the filename (in media_caption, no dedicated column) and sends it referencing that filename so it doesn\'t show up nameless on the client\'s phone', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230008', customer_name: 'Cliente Documento' } });
    const fakeMediaId = `media-id-doc-${Date.now()}`;
    const fakeWamid = `wamid.DOC${Date.now()}`;
    global.fetch = (async (url: string) => {
      if (String(url).endsWith('/media')) return new Response(JSON.stringify({ id: fakeMediaId }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: fakeWamid }] }), { status: 200 });
    }) as any;

    const pdfBytes = Buffer.from('%PDF-1.4 fake but real header').toString('base64');

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/send-document`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: pdfBytes, mime_type: 'application/pdf', filename: 'factura-001.pdf' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json().data;
    expect(msg.media_type).toBe('document');
    expect(msg.media_url).toMatch(/^[0-9a-f]{40}\.pdf$/);
    expect(msg.media_caption).toBe('factura-001.pdf');

    await new Promise((r) => setTimeout(r, 200));
    const stored = await app.prisma.ticketMessage.findUnique({ where: { id: msg.id } });
    expect(stored!.wpp_message_id).toBe(fakeWamid);
  });

  it('POST /:ticketId/send-document rejects a missing filename', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001230009', customer_name: 'Cliente Documento Sin Nombre' } });
    const pdfBytes = Buffer.from('%PDF-1.4 fake but real header').toString('base64');

    const res = await app.inject({
      method: 'POST', url: `/api/v1/inbox/${ticket.id}/send-document`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: pdfBytes, mime_type: 'application/pdf' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /media/:token rejects a malformed token and a well-formed but never-issued one', async () => {
    const malformed = await app.inject({
      method: 'GET', url: '/api/v1/inbox/media/not-a-real-token',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(malformed.statusCode).toBe(400);

    const neverIssued = await app.inject({
      method: 'GET', url: `/api/v1/inbox/media/${'a'.repeat(40)}.jpg`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(neverIssued.statusCode).toBe(404);
  });

  it('GET /media/:token refuses a real token that belongs to a DIFFERENT org, even though the token itself is well-formed and does exist', async () => {
    const otherOrg = await createTestOrg(app.prisma);
    const otherAdmin = await createTestUser(app.prisma, otherOrg.id, 'admin', 'OtherOrgAdmin1!');
    const otherTicket = await app.prisma.ticket.create({ data: { org_id: otherOrg.id, phone: '573001230005', customer_name: 'Cliente Otra Org' } });
    const otherMsg = await app.prisma.ticketMessage.create({
      data: {
        ticket_id: otherTicket.id, direction: 'in', media_type: 'image',
        media_url: `${'b'.repeat(40)}.jpg`,
      },
    });
    void otherAdmin;

    // This test's adminToken is for `orgId`, not `otherOrg` - the token exists and
    // is well-formed, but doesn't belong to this admin's org.
    const res = await app.inject({
      method: 'GET', url: `/api/v1/inbox/media/${otherMsg.media_url}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
