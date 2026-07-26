import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { generateFormLinkUrl } from '../src/lib/formLink.js';

const ADMIN_PASS = 'PublicFormAdmin1!';
const DEVICE = 'device-token-001';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// Mints a real form_link_token the exact same way inbox.ts's GET /form-link does
// (calls the same production function) - there's no JWT to hand-sign anymore, the
// token is just an opaque DB-backed lookup key (see formLink.ts/public.ts).
async function issueFormToken(app: FastifyInstance, ticketId: string, orgId: string, sentByUserId?: string): Promise<string> {
  const url = await generateFormLinkUrl(app as any, ticketId, orgId, sentByUserId);
  return new URL(url).searchParams.get('t')!;
}

// For TTL-boundary tests only - backdates the CURRENT token's issued-at (and
// optionally its opened-at) after a real issueFormToken() call, to simulate time
// having passed without needing the test to actually wait.
async function backdateFormToken(app: FastifyInstance, ticketId: string, issuedAt: Date, openedAt: Date | null = null) {
  await app.prisma.ticket.update({ where: { id: ticketId }, data: { form_token_min_iat: issuedAt, form_link_opened_at: openedAt } });
}

// The 4am-8pm form-hours restriction (isWithinFormHours/shouldBlockForHours) was
// removed - customers writing late at night to get first-in-line tomorrow need the
// form to work right then, not be told to come back in the morning. The link's own
// TTL (flat 24h regardless of whether it was ever opened - see formLink.ts) is the
// only time boundary left; there's nothing to unit-test here anymore.

describe('public form routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminName: string;
  let adminToken: string;
  let ticketId: string;
  let token: string;
  const phone = '573001112200';
  const PHONE4 = '2200';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminId = admin.id;
    adminName = admin.name;
    adminToken = await login(app, admin.email, ADMIN_PASS);

    await app.prisma.product.create({
      data: { org_id: orgId, name: 'Mango', category: 'Frutas', price_per_unit: 3000 },
    });
    await app.prisma.product.create({
      data: { org_id: orgId, name: 'Piña', category: 'Frutas', price_per_unit: 4000 },
    });

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Formulario' },
    });
    ticketId = ticket.id;
    token = await issueFormToken(app, ticketId, orgId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /form-info reports no orders before any pedido exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.orders).toEqual([]);
  });

  let firstOrderId: string;

  it('POST /submit without an address is rejected - address is required, payment method is not', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('POST /submit with no merge_order_id creates a new order (address required, payment optional), items not flagged as client-added', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, address: 'Calle 1 #2-34', items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    firstOrderId = res.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    expect(order.address).toBe('Calle 1 #2-34');
    expect(order.payment_method).toBe('sin_asignar');
    expect(order.client_modified).toBe(false);
    // The client's OWN first submission is the original order, not a later edit -
    // never flagged red even though the client is who created it.
    expect(order.items.every(i => i.added_by_client === false)).toBe(true);
  });

  it('a manually-typed product (not picked from the catalog) is flagged added_by_client on the very first submission - the one exception to the rule above', async () => {
    const manualTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001117788', customer_name: 'Cliente Manual' } });
    const manualToken = await issueFormToken(app, manualTicket.id, orgId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token: manualToken, device_token: 'device-manual', address: 'Calle Manual 1',
        items: [
          { product_name: 'Mango', quantity_label: '2 kg' },
          { product_name: 'Producto raro que no está en el catálogo', quantity_label: '1 unidad', is_manual: true },
        ],
      },
    });
    expect(res.statusCode).toBe(201);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: res.json().data.orderId }, include: { items: true } });
    const catalogItem = order.items.find(i => i.product_name === 'Mango')!;
    const manualItem = order.items.find(i => i.product_name === 'Producto raro que no está en el catálogo')!;
    expect(catalogItem.added_by_client).toBe(false);
    expect(manualItem.added_by_client).toBe(true);
    expect(Number(manualItem.price)).toBe(0); // unknown to the catalog - staff prices it afterward
  });

  it('GET /form-info now lists that order, editable (status nuevo), with its item', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    const orders = res.json().data.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(firstOrderId);
    expect(orders[0].editable).toBe(true);
    expect(orders[0].status).toBe('nuevo');
    expect(orders[0].items).toEqual([{ id: expect.any(String), product_name: 'Mango', quantity_label: '2 kg', price: 3000 }]);
  });

  it('the link is not locked to whichever device opened/submitted it first - any device presenting the same token can view AND submit', async () => {
    // A staff member testing the link (or the customer switching phones, or
    // WhatsApp's own in-app browser previewing it before Safari) must never lock
    // out every OTHER device from then on - the token itself is the only security
    // boundary now (see loadTicketByFormToken's own comment), not a first-claimer
    // device_token. Uses its OWN ticket/token (not the describe block's shared
    // one) so this submit doesn't add a real order the later "merge never counts
    // against the per-link cap" test isn't expecting.
    const multiPhone = '573001112201';
    const multiTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: multiPhone, customer_name: 'Cliente Multi Device' } });
    const multiToken = await issueFormToken(app, multiTicket.id, orgId);

    const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${multiToken}&device_token=some-other-device&phone_last4=2201` });
    expect(formInfo.statusCode).toBe(200);

    const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${multiToken}&device_token=some-other-device&phone_last4=2201` });
    expect(products.statusCode).toBe(200);

    // A different device_token submitting now still succeeds - no lock to reject it.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token: multiToken, device_token: 'some-other-device', phone_last4: '2201', address: 'Calle Test 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(submit.statusCode).toBe(201);

    // A yet-different device is unaffected too - still works fine against the same token.
    const stillOk = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${multiToken}&device_token=yet-another-device&phone_last4=2201` });
    expect(stillOk.statusCode).toBe(200);
  });

  it('phone_last4 is no longer checked at all - a wrong value in the querystring is silently ignored, not rejected', async () => {
    const wrong = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=9999` });
    expect(wrong.statusCode).toBe(200);
  });

  it('GET /link-status answers "is this link alive" with no phone_last4 at all - a revoked link is caught here before the visitor ever sees the digit-entry screen', async () => {
    const statusTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001117700', customer_name: 'Cliente Status' } });
    const statusToken = await issueFormToken(app, statusTicket.id, orgId);

    const alive = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${statusToken}` });
    expect(alive.statusCode).toBe(200);
    expect(alive.json().data.valid).toBe(true);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${statusTicket.id}/form-link/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);

    const dead = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${statusToken}` });
    expect(dead.statusCode).toBe(401);
    expect(dead.json().code).toBe('INVALID_TOKEN');
  });

  it('a link survives past 4 hours whether or not it was ever opened - flat 24h cap either way', async () => {
    const neverOpenedTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112233', customer_name: 'Cliente Nunca Abrio' } });
    const openedTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112234', customer_name: 'Cliente Si Abrio' } });
    const past4h = new Date(Date.now() - 14500 * 1000); // 4h1m40s ago - used to kill an unopened link
    const neverOpenedToken = await issueFormToken(app, neverOpenedTicket.id, orgId);
    const openedToken = await issueFormToken(app, openedTicket.id, orgId);
    await backdateFormToken(app, neverOpenedTicket.id, past4h);
    await backdateFormToken(app, openedTicket.id, past4h, new Date(past4h.getTime() + 60_000));

    const neverOpenedRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${neverOpenedToken}&device_token=stale-device&phone_last4=2233` });
    expect(neverOpenedRes.statusCode).toBe(200);

    const openedRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${openedToken}&device_token=opened-device&phone_last4=2234` });
    expect(openedRes.statusCode).toBe(200);
  });

  it('a link dies past the flat 24h cap, whether or not it was ever opened', async () => {
    const neverOpenedTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112235', customer_name: 'Cliente Nunca Abrio 24h' } });
    const openedTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112236', customer_name: 'Cliente Si Abrio 24h' } });
    const past24h = new Date(Date.now() - (24 * 3600 + 60) * 1000); // 24h1m ago
    const neverOpenedToken = await issueFormToken(app, neverOpenedTicket.id, orgId);
    const openedToken = await issueFormToken(app, openedTicket.id, orgId);
    await backdateFormToken(app, neverOpenedTicket.id, past24h);
    await backdateFormToken(app, openedTicket.id, past24h, new Date(past24h.getTime() + 60_000));

    const neverOpenedRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${neverOpenedToken}&device_token=stale-device&phone_last4=2235` });
    expect(neverOpenedRes.statusCode).toBe(401);
    expect(neverOpenedRes.json().code).toBe('INVALID_TOKEN');

    const openedRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${openedToken}&device_token=opened-device&phone_last4=2236` });
    expect(openedRes.statusCode).toBe(401);
    expect(openedRes.json().code).toBe('INVALID_TOKEN');
  });

  it('POST /submit with merge_order_id replaces the order\'s items with the full submitted list (not append-only), flags only the new/changed line, and sets client_modified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67',
        // payment_method intentionally omitted - should NOT clear the existing value
        // Resubmits the ORIGINAL "Mango: 2 kg" unchanged, plus a new "Piña" line.
        items: [{ product_name: 'Mango', quantity_label: '2 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.merged).toBe(true);
    expect(res.json().data.orderId).toBe(firstOrderId);

    const order = await app.prisma.order.findUniqueOrThrow({
      where: { id: firstOrderId },
      include: { items: true },
    });
    expect(order.items.map(i => i.product_name).sort()).toEqual(['Mango', 'Piña'].sort());
    expect(order.address).toBe('Calle 123 #45-67'); // overwritten - a new value was sent
    expect(order.payment_method).toBe('sin_asignar'); // untouched - nothing new was sent
    expect(order.client_modified).toBe(true);

    const mango = order.items.find(i => i.product_name === 'Mango')!;
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(mango.added_by_client).toBe(false); // unchanged from the original submission
    expect(pina.added_by_client).toBe(true); // brand new line added via this edit

    // Merging must never count against the per-link new-order cap.
    const formOrderCount = await app.prisma.order.count({ where: { ticket_id: ticketId, source: 'form' } });
    expect(formOrderCount).toBe(1);
  });

  it('staff saving the order does NOT clear client_modified - it stays permanently, same as the per-item added_by_client flag', async () => {
    const saveRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${firstOrderId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        items: [
          { product_name: 'Mango', quantity_label: '2 kg', price: 3000, sort_order: 0, added_by_client: false },
          { product_name: 'Piña', quantity_label: '1 unidad', price: 4000, sort_order: 1, added_by_client: true },
        ],
      },
    });
    expect(saveRes.statusCode).toBe(200);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    expect(order.client_modified).toBe(true); // stays set - a staff save no longer clears it
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(pina.added_by_client).toBe(true); // provenance survives the staff save untouched
  });

  it('a client resubmit NEVER overwrites an existing item\'s price with the catalog price, even when the catalog has one - only a brand-new line gets the catalog price', async () => {
    // Mango has a real catalog price_per_unit (3000, set in beforeAll) - staff
    // hand-overrides it on THIS specific order to something different (say, a
    // bulk discount), matching a real "encargado adjusts the price" scenario.
    await app.prisma.orderItem.updateMany({
      where: { order_id: firstOrderId, product_name: 'Mango' },
      data: { price: 2500 },
    });

    // Client resubmits with only the address changed (even a single-letter edit is
    // the exact bug report) - Mango isn't touched at all, just resent as part of
    // "this is the whole order now".
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67x',
        items: [{ product_name: 'Mango', quantity_label: '2 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(200);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    const mango = order.items.find(i => i.product_name === 'Mango')!;
    // Still 2500 - the catalog's 3000 must NOT have silently won.
    expect(Number(mango.price)).toBe(2500);
  });

  it('resubmitting the exact same items/address/payment is a no-op - does not touch client_modified or items', async () => {
    const before = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: before.address,
        items: before.items.map(i => ({ product_name: i.product_name, quantity_label: i.quantity_label })),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.unchanged).toBe(true);

    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } });
    expect(after.client_modified).toBe(before.client_modified);
  });

  it('POST /submit with a merge_order_id whose order became "camino" (out for delivery) while the client was editing is rejected with 409 - NOT silently duplicated as a new order', async () => {
    // Dedicated ticket - isolates this from the shared ticketId's per-link order cap
    // (MAX_FORM_ORDERS_PER_TICKET), which later tests below still rely on being unspent.
    const caminoPhone = '573001112288';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: caminoPhone, customer_name: 'Cliente Camino' } });
    const caminoToken = await issueFormToken(app, ticket.id, orgId);
    const create = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: caminoToken, device_token: 'device-camino', phone_last4: '2288', address: 'Calle Camino 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    const caminoOrderId = create.json().data.orderId;
    await app.prisma.order.update({ where: { id: caminoOrderId }, data: { status: 'camino' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token: caminoToken, device_token: 'device-camino', phone_last4: '2288', merge_order_id: caminoOrderId,
        address: 'Calle Camino 1',
        items: [{ product_name: 'Mango', quantity_label: '1 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');
    expect(res.json().error).toContain('en camino');

    // No duplicate was created - this ticket still has exactly the one order.
    const formOrders = await app.prisma.order.findMany({ where: { ticket_id: ticket.id } });
    expect(formOrders).toHaveLength(1);
    expect(formOrders[0].id).toBe(caminoOrderId);
  });

  it('a pedido an encargado typed up manually (source !== "form") can never be merged into via the client form, even while it\'s otherwise in an editable status', async () => {
    const staffPhone = '573001112260';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: staffPhone, customer_name: 'Cliente Pedido Encargado' } });
    const staffOrderToken = await issueFormToken(app, ticket.id, orgId);
    // Created the way an encargado would - directly via POST /orders, not the form.
    const staffOrder = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '900', customer_name: 'Cliente Pedido Encargado',
        customer_phone: staffPhone, address: 'Calle Encargado 1', payment_method: 'cash',
        registered_by: adminId, fecha: new Date(), source: 'encargado', status: 'nuevo',
        items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token: staffOrderToken, device_token: 'device-staff-order', phone_last4: '2260',
        merge_order_id: staffOrder.id, address: 'Calle Encargado 1',
        items: [{ product_name: 'Mango', quantity_label: '1 kg' }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');

    // Untouched - still exactly the one item staff put on it, at staff's price.
    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: staffOrder.id }, include: { items: true } });
    expect(after.items).toHaveLength(1);
    expect(Number(after.items[0].price)).toBe(3000);
  });

  it('GET /form-info marks a pedido an encargado typed up manually as not editable, even while it\'s in an editable status - the client can only view it', async () => {
    const staffPhone2 = '573001112261';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: staffPhone2, customer_name: 'Cliente Ver Pedido Encargado' } });
    // Colombia-local "today" (UTC-5), same formula GET /form-info itself uses to
    // filter - a bare `new Date()` is the real UTC date, which drifts a calendar day
    // behind Colombia's between 00:00-05:00 UTC (7pm-midnight Colombia), making this
    // order invisible to the very query being tested during exactly that window.
    const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '901', customer_name: 'Cliente Ver Pedido Encargado',
        customer_phone: staffPhone2, address: 'Calle Encargado 2', payment_method: 'cash',
        registered_by: adminId, fecha: todayLocal, source: 'encargado', status: 'nuevo',
        items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
      },
    });
    const viewToken = await issueFormToken(app, ticket.id, orgId);

    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${viewToken}&device_token=device-view&phone_last4=2261` });
    expect(res.statusCode).toBe(200);
    const orders = res.json().data.orders as any[];
    expect(orders).toHaveLength(1);
    expect(orders[0].editable).toBe(false);
    expect(orders[0].items[0].price).toBe(3000);
  });

  it('POST /submit with a merge_order_id that is no longer open (closed in the meantime) is rejected with 409, not silently duplicated', async () => {
    await app.prisma.order.update({
      where: { id: firstOrderId },
      data: { status: 'cerrado', paid: true, locked: true, paid_by: adminId, paid_at: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, merge_order_id: firstOrderId, address: 'Calle Cerrado 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');
  });

  it('GET /form-info no longer lists the closed order at all - nothing left for the client to see or do with it', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    const orders = res.json().data.orders as any[];
    expect(orders.find(o => o.id === firstOrderId)).toBeUndefined();
  });

  it('GET /form-info still lists a "camino" order, read-only', async () => {
    const caminoPhone2 = '573001112266';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: caminoPhone2, customer_name: 'Cliente Camino 2' } });
    const caminoToken2 = await issueFormToken(app, ticket.id, orgId);
    const create = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: caminoToken2, device_token: 'device-camino-2', phone_last4: '2266', address: 'Calle Camino 2', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    const orderId = create.json().data.orderId;
    await app.prisma.order.update({ where: { id: orderId }, data: { status: 'camino' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${caminoToken2}&device_token=device-camino-2&phone_last4=2266` });
    const orders = res.json().data.orders as any[];
    const found = orders.find(o => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.editable).toBe(false);
    expect(found.status).toBe('camino');
  });

  it('GET /inbox/:ticketId/form-link embeds who sent it and is a short opaque token, not a long JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticketId}/form-link`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const url = res.json().data.url as string;
    const sentToken = new URL(url).searchParams.get('t')!;

    // Plain [0-9a-f], no JWT dots/base64url punctuation - a long self-contained JWT
    // (~280 chars) is exactly what got silently truncated by a real customer's
    // mobile keyboard/clipboard, corrupting the signature and showing "link
    // inválido" for a link that was actually fine. 40 hex chars is short enough to
    // survive that and still 160 bits of entropy - unguessable either way.
    expect(sentToken).toMatch(/^[0-9a-f]{40}$/);

    // There's no token payload to decode anymore - who sent it and when live on the
    // ticket row itself (public.ts's loadTicketByFormToken reads them from there).
    const ticket = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.form_link_token).toBe(sentToken);
    expect(ticket.form_link_sent_by).toBe(adminId);
    expect(ticket.form_token_min_iat).not.toBeNull();
    const msSinceIssued = Date.now() - ticket.form_token_min_iat!.getTime();
    expect(msSinceIssued).toBeGreaterThanOrEqual(0);
    expect(msSinceIssued).toBeLessThan(10_000);
  });

  it('an order created through a real /form-link token is attributed to (registered_by) the staff member who sent it, and the history note names them', async () => {
    const linkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticketId}/form-link`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const sentToken = new URL(linkRes.json().data.url).searchParams.get('t')!;

    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token: sentToken, device_token: 'device-002', phone_last4: PHONE4, address: 'Calle Atribucion 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(submitRes.statusCode).toBe(201);
    const newOrderId = submitRes.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({
      where: { id: newOrderId },
      include: { history: true },
    });
    expect(order.registered_by).toBe(adminId);
    const createEntry = order.history.find(h => h.action_type === 'create');
    expect(createEntry?.notes).toContain(adminName);
    expect(createEntry?.actor_id).toBe(adminId);
  });

  describe('POST /public/order/:orderId/delete - client cancels their own order', () => {
    it('marks client_deleted (status untouched, NOT papelera) on an editable order the client submitted, and it disappears from form-info afterward', async () => {
      const phone = '573001112270';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Elimina Pedido' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const create = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token, device_token: 'device-delete-1', address: 'Calle Elimina 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      expect(create.statusCode).toBe(201);
      const orderId = create.json().data.orderId;

      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-delete-1' },
      });
      expect(del.statusCode).toBe(200);

      const after = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(after.status).toBe('nuevo'); // untouched - stays visible on the board, just flagged
      expect(after.client_deleted).toBe(true);

      const info = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=device-delete-1` });
      expect(info.json().data.orders).toHaveLength(0);

      const history = await app.prisma.orderHistory.findMany({ where: { order_id: orderId } });
      expect(history.some(h => h.action_type === 'eliminado_cliente' && h.notes?.includes('formulario'))).toBe(true);
    });

    it('rejects deleting an order that already moved past listo (e.g. camino) - 400 NOT_EDITABLE, order untouched', async () => {
      const phone = '573001112271';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Pedido En Camino' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const create = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token, device_token: 'device-delete-2', address: 'Calle Camino 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      const orderId = create.json().data.orderId;
      await app.prisma.order.update({ where: { id: orderId }, data: { status: 'camino' } });

      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-delete-2' },
      });
      expect(del.statusCode).toBe(400);
      expect(del.json().code).toBe('NOT_EDITABLE');

      const after = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(after.status).toBe('camino');
    });

    it('rejects deleting a pedido an encargado typed up manually (source !== "form"), even while still nuevo', async () => {
      const phone = '573001112272';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Pedido Encargado Del' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const staffOrder = await app.prisma.order.create({
        data: {
          // Not a small fixed number like the other manual-order fixtures here - this
          // file's growing pile of /submit calls auto-assigns sequential nums (MAX+1
          // per org+fecha) that can collide with any hardcoded low number by the time
          // this test runs, depending on execution order.
          org_id: orgId, ticket_id: ticket.id, num: `E${Date.now() % 1000000}`, customer_name: 'Cliente Pedido Encargado Del',
          customer_phone: phone, address: 'Calle Encargado 3', payment_method: 'cash',
          registered_by: adminId, fecha: new Date(), source: 'encargado', status: 'nuevo',
          items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
        },
      });

      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${staffOrder.id}/delete`,
        payload: { token, device_token: 'device-delete-3' },
      });
      expect(del.statusCode).toBe(400);
      expect(del.json().code).toBe('NOT_EDITABLE');
    });

    it('a different device_token than the one that created the order can still delete it - same token, no device lock', async () => {
      const phone = '573001112273';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Delete Otro Device' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const create = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token, device_token: 'device-real', address: 'Calle Mismatch 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      const orderId = create.json().data.orderId;

      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-otro' },
      });
      expect(del.statusCode).toBe(200);

      const after = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(after.status).toBe('nuevo');
      expect(after.client_deleted).toBe(true);
    });

    it('rejects an order belonging to a different ticket than the one the token was issued for', async () => {
      const phoneA = '573001112274';
      const phoneB = '573001112275';
      const ticketA = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneA, customer_name: 'Cliente A' } });
      const ticketB = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneB, customer_name: 'Cliente B' } });
      const tokenA = await issueFormToken(app, ticketA.id, orgId);
      const tokenB = await issueFormToken(app, ticketB.id, orgId);
      const createB = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token: tokenB, device_token: 'device-b', address: 'Calle B 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      const orderBId = createB.json().data.orderId;

      // ticketA's own token/device trying to delete ticketB's order.
      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderBId}/delete`,
        payload: { token: tokenA, device_token: 'device-a' },
      });
      expect(del.statusCode).toBe(404);

      const after = await app.prisma.order.findUniqueOrThrow({ where: { id: orderBId } });
      expect(after.status).toBe('nuevo');
    });

    it('rejects deleting the same order twice - 400 ALREADY_DELETED', async () => {
      const phone = '573001112276';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Doble Delete' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const create = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token, device_token: 'device-double', address: 'Calle Doble 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      const orderId = create.json().data.orderId;

      const first = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-double' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-double' },
      });
      expect(second.statusCode).toBe(400);
      expect(second.json().code).toBe('ALREADY_DELETED');
    });

    it('rejects resubmitting (merge_order_id) into a client_deleted order even though its status is still editable - 409 ORDER_NOT_EDITABLE', async () => {
      const phone = '573001112277';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Resubmit Tras Delete' } });
      const token = await issueFormToken(app, ticket.id, orgId);
      const create = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token, device_token: 'device-resub', address: 'Calle Resub 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      const orderId = create.json().data.orderId;

      const del = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${orderId}/delete`,
        payload: { token, device_token: 'device-resub' },
      });
      expect(del.statusCode).toBe(200);

      const resubmit = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: {
          token, device_token: 'device-resub', merge_order_id: orderId,
          address: 'Calle Resub Nueva 2', items: [{ product_name: 'Mango', quantity_label: '2 kg' }],
        },
      });
      expect(resubmit.statusCode).toBe(409);
      expect(resubmit.json().code).toBe('ORDER_NOT_EDITABLE');
    });
  });

  describe('form-link revocation', () => {
    const revokedPhone = '573001112299';
    let revokedTicketId: string;
    let revokedToken: string;

    beforeAll(async () => {
      const ticket = await app.prisma.ticket.create({
        data: { org_id: orgId, phone: revokedPhone, customer_name: 'Cliente Revocado' },
      });
      revokedTicketId = ticket.id;
      revokedToken = await issueFormToken(app, revokedTicketId, orgId);
    });

    it('POST /inbox/:ticketId/form-link/revoke requires auth', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/inbox/${revokedTicketId}/form-link/revoke`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('after revoking, the previously-issued token is rejected on every public endpoint (fails closed)', async () => {
      const revoke = await app.inject({
        method: 'POST',
        url: `/api/v1/inbox/${revokedTicketId}/form-link/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Enviado al número equivocado' },
      });
      expect(revoke.statusCode).toBe(200);

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${revokedToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(formInfo.statusCode).toBe(401);
      expect(formInfo.json().code).toBe('INVALID_TOKEN');

      const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${revokedToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(products.statusCode).toBe(401);

      const submit = await app.inject({
        method: 'POST',
        url: '/api/v1/public/submit',
        payload: { token: revokedToken, device_token: DEVICE, phone_last4: '2299', address: 'Calle Revocado 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      expect(submit.statusCode).toBe(401);
      expect(submit.json().code).toBe('INVALID_TOKEN');
    });

    it('generating a fresh form-link clears the earlier revocation, so the new link works', async () => {
      const linkRes = await app.inject({
        method: 'GET',
        url: `/api/v1/inbox/${revokedTicketId}/form-link`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(linkRes.statusCode).toBe(200);
      const freshToken = new URL(linkRes.json().data.url).searchParams.get('t')!;

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(formInfo.statusCode).toBe(200);
    });

    it('sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, no manual "Bloquear link" needed', async () => {
      const phone = '573001112255';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Reenvio' } });

      const first = await app.inject({
        method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` },
      });
      const firstToken = new URL(first.json().data.url).searchParams.get('t')!;

      const firstWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${firstToken}&device_token=resend-device&phone_last4=2255` });
      expect(firstWorks.statusCode).toBe(200);

      // Staff sends a second link for the same ticket (e.g. a reminder) - the first
      // one must die automatically, with no separate revoke call.
      const second = await app.inject({
        method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` },
      });
      const secondToken = new URL(second.json().data.url).searchParams.get('t')!;
      expect(secondToken).not.toBe(firstToken);

      const firstNowBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${firstToken}&device_token=resend-device&phone_last4=2255` });
      expect(firstNowBlocked.statusCode).toBe(401);
      expect(firstNowBlocked.json().code).toBe('INVALID_TOKEN');

      const secondWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${secondToken}&device_token=resend-device-2&phone_last4=2255` });
      expect(secondWorks.statusCode).toBe(200);
    });
  });

  // Covers the "bloquear link bloquea TODOS los links de ese chat" requirement -
  // several links sent over time for the same ticket all embed the same ticketId,
  // and revocation is keyed purely by ticketId, so one block call must invalidate
  // every one of them at once, not just whichever was issued last.
  // There used to be a separate "blocking a link blocks every link ever issued for
  // that ticket, not just the latest" test here, from back when a form link was a
  // self-contained JWT: multiple independently-signed tokens could all be
  // simultaneously "valid" for one ticket (each checked only against its own
  // supersession state), so revoke had to be proven to catch all of them at once.
  // Now the token is a single opaque value stored directly on the ticket row
  // (form_link_token) - there is only ever ONE live link per ticket by construction,
  // so that scenario can no longer happen at all; the revocation test above already
  // covers "the current link dies when revoked".

  // A ticket is now one row per phone FOREVER (schema.prisma), not per day - so the
  // per-link new-order cap (MAX_FORM_ORDERS_PER_TICKET=3, public.ts) must be scoped
  // to TODAY, not the ticket's whole lifetime, or a long-time customer eventually
  // places their 4th-ever form order and is permanently locked out of the link.
  it('the per-link new-order cap only counts TODAY\'s form orders - old-day orders never count against it, and a fresh day resets it', async () => {
    const capPhone = '573001112244';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: capPhone, customer_name: 'Cliente Limite Diario' } });
    const capToken = await issueFormToken(app, ticket.id, orgId);
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'admin' } });

    // 5 old form orders from a past day - well over the cap of 3, but none of them
    // should count since they're not from today.
    for (let i = 0; i < 5; i++) {
      await app.prisma.order.create({
        data: {
          org_id: orgId, ticket_id: ticket.id, num: String(i + 1).padStart(3, '0'),
          customer_name: 'Cliente Limite Diario', address: 'Calle vieja', payment_method: 'cash',
          registered_by: admin.id, fecha: new Date('2026-01-01'), source: 'form',
        },
      });
    }

    const device = 'device-limite-diario';
    // 3 new orders TODAY should all succeed (the cap, but for today).
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token: capToken, device_token: device, phone_last4: '2244', address: 'Calle Limite 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      expect(res.statusCode).toBe(201);
    }
    // The 4th today hits the cap.
    const blocked = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: capToken, device_token: device, phone_last4: '2244', address: 'Calle Limite 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('FORM_LIMIT_REACHED');
  });

  describe('POST /inbox/form-links/block-all - org-wide kill switch', () => {
    it('requires admin - encargado forbidden, no auth rejected', async () => {
      const ENCARGADO_PASS = 'BlockAllEncargado1!';
      const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS, {
        email: `blockall-encargado-${Date.now()}@example.com`,
      });
      const encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);

      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/v1/inbox/form-links/block-all',
        headers: { authorization: `Bearer ${encargadoToken}` },
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().code).toBe('FORBIDDEN');

      const noAuth = await app.inject({ method: 'POST', url: '/api/v1/inbox/form-links/block-all' });
      expect(noAuth.statusCode).toBe(401);
    });

    it('blocks every outstanding link across every ticket in the org at once, and a link issued afterward still works', async () => {
      const phoneA = '573001112211';
      const phoneB = '573001112222';
      const ticketA = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneA, customer_name: 'Cliente Block A' } });
      const ticketB = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneB, customer_name: 'Cliente Block B' } });
      const tokenA = await issueFormToken(app, ticketA.id, orgId);
      const tokenB = await issueFormToken(app, ticketB.id, orgId);

      const aWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenA}&device_token=block-a&phone_last4=2211` });
      expect(aWorks.statusCode).toBe(200);
      const bWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenB}&device_token=block-b&phone_last4=2222` });
      expect(bWorks.statusCode).toBe(200);

      const block = await app.inject({
        method: 'POST',
        url: '/api/v1/inbox/form-links/block-all',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(block.statusCode).toBe(200);

      const aBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenA}&device_token=block-a&phone_last4=2211` });
      expect(aBlocked.statusCode).toBe(401);
      const bBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenB}&device_token=block-b&phone_last4=2222` });
      expect(bBlocked.statusCode).toBe(401);

      // A link issued AFTER the org-wide block still works - issueFormToken calls
      // the real generateFormLinkUrl, which also clears ticketA's FormLinkSession,
      // so the same device_token claiming it again here is fine too.
      const freshToken = await issueFormToken(app, ticketA.id, orgId);
      const freshWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=block-a&phone_last4=2211` });
      expect(freshWorks.statusCode).toBe(200);
    });
  });
});

// The wrong-PIN lockout ladder itself (registerFailedLinkAttempt / MAX_ATTEMPTS_SOFT
// / MAX_ATTEMPTS_HARD in lib/linkSecurity.ts) is left in place as dormant infra, but
// nothing calls it anymore now that phone_last4 isn't checked - so there is no
// remaining code path to exercise here. Covered instead by the TTL/revocation/
// supersession tests above, which are the security boundary now.

describe('public /submit - Meta WhatsApp delivery tracking on the order confirmation message', () => {
  let app: FastifyInstance;
  let orgId: string;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    // No WPP_TOKEN_ENC_KEY in the test env - crypto.ts treats an unprefixed value as
    // legacy plaintext, so a plain string round-trips fine without real encryption.
    await app.prisma.organization.update({
      where: { id: orgId },
      data: { wpp_meta_phone_id: 'test-phone-id', wpp_meta_token: 'test-token' },
    });
    await createTestUser(app.prisma, orgId, 'admin', 'SubmitWppAdmin1!');
    originalFetch = global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  it('the "pedido recibido" confirmation sent to the client stores the real Meta message id, not the hardcoded null it used to send', async () => {
    const phone = '573001119920';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Submit WPP' } });
    const token = await issueFormToken(app, ticket.id, orgId);
    // Unique per test run, not a fixed literal - wpp_message_id is globally unique,
    // and a hardcoded value would collide with a leftover row from a previous run
    // against the same (not wiped between runs) test database. Also unique PER
    // CALL (a counter suffix) - submitting with no payment_method sends a second
    // message (the "¿Efectivo o transferencia?" nudge), and a real Meta response
    // never reuses the same wamid for two different sends the way a naive static
    // mock would.
    let fakeWamidCounter = 0;
    const fakeWamidBase = `wamid.SUBMITOK${Date.now()}`;
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `${fakeWamidBase}-${fakeWamidCounter++}` }] }), { status: 200 })) as any;

    const res = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token, device_token: 'device-wpp-submit', phone_last4: '9920', address: 'Calle WPP 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(201);

    const outbound = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticket.id, direction: 'out' }, orderBy: { sent_at: 'asc' } });
    expect(outbound[0].wpp_message_id).toBe(`${fakeWamidBase}-0`);
    // No payment_method in the payload above - the "¿Efectivo o transferencia?"
    // nudge should have gone out right after, as its own message.
    expect(outbound).toHaveLength(2);
    expect(outbound[1].text).toBe('¿Efectivo o transferencia?');
    expect(outbound[1].wpp_message_id).toBe(`${fakeWamidBase}-1`);
  });
});

describe('public /submit - cobro en casa chosen by the client on the form', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'CodFormAdmin1!');
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: admin.email, password: 'CodFormAdmin1!' } });
    adminToken = login.json().data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a client picking "Cobro en casa" on the public form never decides completo/vuelta themselves - the order lands with it unset, and staff can set it afterward from the app', async () => {
    const phone = '573001119930';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Cod Form' } });
    const token = await issueFormToken(app, ticket.id, orgId);

    const submit = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: {
        token, device_token: 'device-cod-form', phone_last4: '9930', address: 'Calle Cod Form 1',
        payment_method: 'cod', items: [{ product_name: 'Mango', quantity_label: '1 kg' }],
      },
    });
    expect(submit.statusCode).toBe(201);
    const orderId = submit.json().data.orderId;

    // Nothing about completo/vuelta was ever asked of the client - the public
    // /submit schema has no cod_choice/amount_received field at all, so the order
    // lands exactly the same way an encargado-created cod order does before anyone
    // has decided: both null.
    const created = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(created.payment_method).toBe('cod');
    expect(created.cod_choice).toBeNull();
    expect(created.amount_received).toBeNull();

    // Staff opens the order in the app and sets it - same PATCH any encargado-made
    // cod order goes through, no special-casing needed for a form-created one.
    await app.prisma.orderItem.updateMany({ where: { order_id: orderId }, data: { price: 3000 } });
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/orders/${orderId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount_received: 3000, cod_choice: 'completo' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.cod_choice).toBe('completo');
  });
});
