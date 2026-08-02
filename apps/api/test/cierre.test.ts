import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const ENCARGADO_PASS = 'CierreEncargado1!';

function sampleOrderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Cliente Cierre',
    address: 'Av. Siempre Viva 742',
    channel: 'call',
    payment_method: 'cash',
    items: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }],
    ...overrides,
  };
}

// Colombia local date (UTC-5, no DST) - matches exactly what cierre.ts's own
// "only today" check computes, so tests actually land on the day the server
// considers "today" regardless of the machine/CI runner's own timezone.
function todayColombiaStr(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

describe('cierre routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // Cierre can now only ever target TODAY (see cierre.ts's NOT_TODAY check) - a
  // DailyClose row is unique per (org, fecha), so every test below that closes
  // "today" needs its OWN org, or it'd collide with another test's close of the
  // same org+day and get a false 409 ALREADY_CLOSED instead of testing what it means to.
  async function freshOrgAndEncargado() {
    const org = await createTestOrg(app.prisma);
    const encargado = await createTestUser(app.prisma, org.id, 'encargado', ENCARGADO_PASS);
    const token = await login(app, encargado.email, ENCARGADO_PASS);
    return { orgId: org.id, encargadoToken: token };
  }

  it('cierre on a date other than today -> 400 NOT_TODAY (neither future nor past can be closed)', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const yesterday = new Date(Date.now() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() - 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const pastAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha: yesterday, decisions: {} },
    });
    expect(pastAttempt.statusCode).toBe(400);
    expect(pastAttempt.json().code).toBe('NOT_TODAY');

    const futureAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha: tomorrow, decisions: {} },
    });
    expect(futureAttempt.statusCode).toBe(400);
    expect(futureAttempt.json().code).toBe('NOT_TODAY');
  });

  it('moving a pending order to "manana" moves its fecha to tomorrow and PRESERVES original notes with the pasado_manana marker appended (B3 fix)', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();
    const originalNotes = 'Entregar por la puerta trasera, tocar el timbre dos veces';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha, notes: originalNotes }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;
    expect(order.notes).toBe(originalNotes);

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: {
        fecha,
        decisions: { [order.id]: 'manana' },
      },
    });
    expect(cierre.statusCode).toBe(200);

    const updated = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(updated).not.toBeNull();

    // fecha moved to tomorrow
    const expectedTomorrow = new Date(fecha);
    expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
    expect(updated!.fecha.toISOString().split('T')[0]).toBe(expectedTomorrow.toISOString().split('T')[0]);

    // original notes preserved, marker appended - NOT overwritten
    const marker = `pasado_manana:${fecha}`;
    expect(updated!.notes).toContain(originalNotes);
    expect(updated!.notes).toContain(marker);
    expect(updated!.notes).toBe(`${originalNotes}\n${marker}`);
  });

  it('a phone can only ever have one ticket per org (@@unique(org_id, phone)) - deferring to "manana" just re-flags the same row, never forks a second one', async () => {
    const { orgId, encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();
    const tomorrow = new Date(fecha);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const phone = '573001112233';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha, customer_phone: phone }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: new Date(fecha) },
    });
    await app.prisma.order.update({ where: { id: order.id }, data: { ticket_id: ticket.id } });

    // A second ticket for the same org+phone is a DB-level impossibility now, not just
    // something the app happens to avoid - this is what actually prevents the
    // "Pedidos"/"Ver conversación" vs "Chats WPP" split from ever recurring.
    await expect(
      app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: tomorrow } })
    ).rejects.toThrow();

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'manana' } },
    });
    expect(cierre.statusCode).toBe(200);

    const stillOneTicket = await app.prisma.ticket.findMany({ where: { org_id: orgId, phone } });
    expect(stillOneTicket).toHaveLength(1);
    expect(stillOneTicket[0].id).toBe(ticket.id);
    expect(stillOneTicket[0].deferred_to?.toISOString().split('T')[0]).toBe(tomorrow.toISOString().split('T')[0]);
  });

  it('cierre without a decision for a pending order -> 400 MISSING_DECISIONS', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: {
        fecha,
        decisions: {},
      },
    });
    expect(cierre.statusCode).toBe(400);
    expect(cierre.json().code).toBe('MISSING_DECISIONS');
    const pendingIds: string[] = cierre.json().pending.map((p: { id: string }) => p.id);
    expect(pendingIds).toContain(order.id);
  });

  it('closing an already-closed day again -> 409 ALREADY_CLOSED, and the day stays closed', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const firstCierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(firstCierre.statusCode).toBe(200);

    const secondCierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: {} },
    });
    expect(secondCierre.statusCode).toBe(409);
    expect(secondCierre.json().code).toBe('ALREADY_CLOSED');
  });

  it('GET /cierre/status reflects whether the day has been closed, and "forzar_cierre" (cerrar sin cobro) closes the order WITHOUT marking it paid', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/cierre/status?fecha=${fecha}`,
      headers: authHeader(encargadoToken),
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.cerrado).toBe(false);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    const order = create.json().data;

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(cierre.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/cierre/status?fecha=${fecha}`,
      headers: authHeader(encargadoToken),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.cerrado).toBe(true);
    expect(after.json().data.closedAt).not.toBeNull();

    // "Cerrar sin cobro" means exactly that - closed/dead, but never marked as paid.
    const closedOrder = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(closedOrder!.status).toBe('cerrado');
    expect(closedOrder!.paid).toBe(false);
    expect(closedOrder!.paid_at).toBeNull();
  });

  it('once a day is closed, EVERY order on it is frozen - even one that was never individually locked, purely because the day itself closed', async () => {
    const { orgId, encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    const order = create.json().data;

    // A second order on the same day that's already 'cerrado' but was never
    // individually locked (e.g. seeded/imported another way) - not part of
    // "pendientes" (paid:false + status not in cerrado/papelera), so it needs no
    // cierre decision of its own. This is exactly the case a plain `existing.locked`
    // check on PATCH /orders/:id would let through - only the DAY_CLOSED check
    // (independent of any one order's own `locked` flag) catches it.
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'encargado' } });
    const unlockedClosedOrder = await app.prisma.order.create({
      data: {
        org_id: orgId, num: '999', customer_name: 'Pedido ya cerrado sin lock',
        address: 'Calle 1', payment_method: 'cash', status: 'cerrado', locked: false,
        registered_by: admin.id, fecha: new Date(fecha),
      },
    });

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(cierre.statusCode).toBe(200);

    const stillUnlocked = await app.prisma.order.findUnique({ where: { id: unlockedClosedOrder.id } });
    expect(stillUnlocked!.locked).toBe(false);

    const editAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${unlockedClosedOrder.id}`,
      headers: authHeader(encargadoToken),
      payload: { address: 'Nueva dirección después de cerrado' },
    });
    expect(editAttempt.statusCode).toBe(409);
    expect(editAttempt.json().code).toBe('DAY_CLOSED');

    const statusAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${unlockedClosedOrder.id}/status`,
      headers: authHeader(encargadoToken),
      payload: { status: 'preparando' },
    });
    expect(statusAttempt.statusCode).toBe(409);
    expect(statusAttempt.json().code).toBe('DAY_CLOSED');

    const createAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(createAttempt.statusCode).toBe(409);
    expect(createAttempt.json().code).toBe('DAY_CLOSED');
  });

  describe('deferring to "mañana" RENUMBERS the order into tomorrow\'s own consecutive sequence', () => {
    // Each test below needs its OWN org (cierre only ever closes the real
    // "today", and DailyClose is unique per org+fecha - two tests closing
    // "today" for the SAME org would 409 ALREADY_CLOSED on the second one), but
    // signs its own token directly via fastify.jwt.sign instead of the usual
    // freshOrgAndEncargado()/login() HTTP round-trip - POST /auth/login has its
    // OWN tight rate limit (10/min, see auth.ts), separate from and much
    // stricter than the app-wide default, and this file's existing tests were
    // already close to it; 4 more real logins reliably tipped it into 429.
    // Signing directly skips that route entirely while still producing a token
    // the SAME @fastify/jwt secret verifies as genuine.
    async function orgWithDirectToken(role: 'encargado' | 'admin' = 'encargado') {
      const org = await createTestOrg(app.prisma);
      const user = await createTestUser(app.prisma, org.id, role, 'unused-not-logged-in-1!');
      const token = app.jwt.sign({ userId: user.id, orgId: org.id, role }, { expiresIn: '15m' });
      return { orgId: org.id, userId: user.id, token };
    }

    it('a single deferred order becomes #001 tomorrow, not keeping its high original num', async () => {
      const { orgId, userId: adminId, token: encargadoToken } = await orgWithDirectToken();
      const fecha = todayColombiaStr();

      // Directly seed a high num (013), same as if this were the 13th order of
      // the day - createOrderWithRetryNum would take many creates to get there,
      // a direct insert is equivalent and much faster for the test.
      await app.prisma.order.create({
        data: {
          org_id: orgId, num: '013', customer_name: 'Cliente Alto', customer_phone: '573000000013',
          address: 'Calle X', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: adminId, fecha: new Date(fecha),
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });
      const order = await app.prisma.order.findFirstOrThrow({ where: { org_id: orgId, num: '013' } });

      const cierre = await app.inject({
        method: 'POST', url: '/api/v1/cierre', headers: authHeader(encargadoToken),
        payload: { fecha, decisions: { [order.id]: 'manana' } },
      });
      expect(cierre.statusCode).toBe(200);

      const updated = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.num).toBe('001');
    });

    it('#13 and #24 both deferred the same cierre become #001 and #002 tomorrow, in that order - never keeping 13/24', async () => {
      const { orgId, userId: adminId, token: encargadoToken } = await orgWithDirectToken();
      const fecha = todayColombiaStr();

      const order13 = await app.prisma.order.create({
        data: {
          org_id: orgId, num: '013', customer_name: 'Cliente 13', customer_phone: '573000000013',
          address: 'Calle X', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: adminId, fecha: new Date(fecha),
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });
      const order24 = await app.prisma.order.create({
        data: {
          org_id: orgId, num: '024', customer_name: 'Cliente 24', customer_phone: '573000000024',
          address: 'Calle X', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: adminId, fecha: new Date(fecha),
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });

      const cierre = await app.inject({
        method: 'POST', url: '/api/v1/cierre', headers: authHeader(encargadoToken),
        payload: { fecha, decisions: { [order13.id]: 'manana', [order24.id]: 'manana' } },
      });
      expect(cierre.statusCode).toBe(200);

      const updated13 = await app.prisma.order.findUniqueOrThrow({ where: { id: order13.id } });
      const updated24 = await app.prisma.order.findUniqueOrThrow({ where: { id: order24.id } });
      // The one that was FIRST (lower original num, #13) stays first tomorrow (#001) -
      // the one that was SECOND (#24) stays second (#002), regardless of the order
      // the decisions object happened to list them in.
      expect(updated13.num).toBe('001');
      expect(updated24.num).toBe('002');
    });

    it('deferred orders continue AFTER whatever already exists on tomorrow (e.g. an overnight form order), not always starting at 1', async () => {
      const { orgId, userId: adminId, token: encargadoToken } = await orgWithDirectToken();
      const fecha = todayColombiaStr();
      const tomorrow = new Date(fecha);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Simulates a client form order that already rolled forward onto tomorrow
      // overnight (public.ts's "already closed -> roll to tomorrow" path) before
      // cierre even ran.
      await app.prisma.order.create({
        data: {
          org_id: orgId, num: '001', customer_name: 'Cliente Nocturno', customer_phone: '573000000099',
          address: 'Calle Nocturna', channel: 'whatsapp', payment_method: 'cash', status: 'nuevo', source: 'form',
          registered_by: adminId, fecha: tomorrow,
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });

      const order = await app.prisma.order.create({
        data: {
          org_id: orgId, num: '005', customer_name: 'Cliente Pospuesto', customer_phone: '573000000005',
          address: 'Calle X', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: adminId, fecha: new Date(fecha),
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });

      const cierre = await app.inject({
        method: 'POST', url: '/api/v1/cierre', headers: authHeader(encargadoToken),
        payload: { fecha, decisions: { [order.id]: 'manana' } },
      });
      expect(cierre.statusCode).toBe(200);

      const updated = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      // Tomorrow already had #001 - the deferred order must NOT collide with it,
      // continuing the consecutive sequence at #002.
      expect(updated.num).toBe('002');
    });

    it('a brand-new order created on tomorrow AFTER cierre defers into it continues the consecutive count - no gap, no collision', async () => {
      const { orgId, userId: adminId, token: encargadoToken } = await orgWithDirectToken();
      const fecha = todayColombiaStr();
      const tomorrow = new Date(fecha);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const order13 = await app.prisma.order.create({
        data: {
          org_id: orgId, num: '013', customer_name: 'Cliente 13', customer_phone: '573000000013',
          address: 'Calle X', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: adminId, fecha: new Date(fecha),
          items: { create: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }] },
        },
      });

      const cierre = await app.inject({
        method: 'POST', url: '/api/v1/cierre', headers: authHeader(encargadoToken),
        payload: { fecha, decisions: { [order13.id]: 'manana' } },
      });
      expect(cierre.statusCode).toBe(200);

      const next = await app.inject({
        method: 'POST', url: '/api/v1/orders', headers: authHeader(encargadoToken),
        payload: sampleOrderPayload({ fecha: tomorrowStr }),
      });
      expect(next.statusCode).toBe(201);
      // #013 became #001 at cierre - the next NEW order on that day continues
      // straight to #002, not #014 and not colliding with #001.
      expect(next.json().data.num).toBe('002');
    });
  });
});
