// Reglas de 2026-10-10 (decisiones de José):
//  A. Cerrar caja congela TODO el día (RN-CAJ-21): restaurar, mover desde/hacia
//     papelera, cobrar, cobro retroactivo y el borrado del propio cliente también
//     responden 409 DAY_CLOSED. Excepciones: observaciones y marcar crédito pagado.
//  B. Editar un pedido ya cobrado con el día abierto recalcula el cobro
//     (RN-CAJ-26 a RN-CAJ-28): cambiar el método es solo admin y exige desglose;
//     si el total cambia, también; el informe en vivo refleja el nuevo reparto.
//  C. La API rechaza cobrar pedidos en papelera o eliminados por el cliente (RN-CAJ-29).
// Cada test usa su propia organización (una fila DailyClose es única por org+fecha).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { generateFormLinkUrl } from '../src/lib/formLink.js';

const PASS = 'CongelaCobrados1!';
const FECHA = '2026-10-10';

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('cierre congela el día y edición de pedidos ya cobrados', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // Tokens firmados directamente (sin /auth/login, que tiene límite de 10/min
  // compartido por todo el archivo). La contraseña sí es real: el cobro la verifica.
  async function setup() {
    const org = await createTestOrg(app.prisma);
    const admin = await createTestUser(app.prisma, org.id, 'admin', PASS);
    const encargado = await createTestUser(app.prisma, org.id, 'encargado', PASS);
    const domiciliario = await createTestUser(app.prisma, org.id, 'domiciliario', PASS);
    const sign = (u: { id: string; role: string }) =>
      app.jwt.sign({ userId: u.id, orgId: org.id, role: u.role as any }, { expiresIn: '15m' });
    const employee = await app.prisma.employee.create({ data: { org_id: org.id, name: 'Domiciliario Prueba' } });
    return {
      orgId: org.id, adminId: admin.id, employeeId: employee.id,
      adminToken: sign(admin), encargadoToken: sign(encargado), domiciliarioToken: sign(domiciliario),
    };
  }

  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function createOrder(ctx: Ctx, overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/orders', headers: authHeader(ctx.encargadoToken),
      payload: {
        customer_name: 'Cliente Ficticio', customer_phone: '3000000000', address: 'Calle Falsa 123',
        channel: 'call', payment_method: 'cash', employee_id: ctx.employeeId, fecha: FECHA,
        items: [
          { product_name: 'Papa Criolla', quantity_label: '2 kg', price: 30000, sort_order: 0 },
          { product_name: 'Cebolla Roja', quantity_label: '1 kg', price: 20000, sort_order: 1 },
        ],
        ...overrides,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; items: any[] };
  }

  async function cobrar(ctx: Ctx, orderId: string, amount: number, split?: { cash: number; transfer: number }) {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/orders/${orderId}/cobro`, headers: authHeader(ctx.encargadoToken),
      payload: { amount_received: amount, password: PASS, ...(split ? { split } : {}) },
    });
    return res;
  }

  async function closeDay(ctx: Ctx) {
    await app.prisma.dailyClose.create({ data: { org_id: ctx.orgId, fecha: new Date(FECHA), closed_by: ctx.adminId } });
  }

  async function recaudado(ctx: Ctx) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/dashboard?fecha=${FECHA}`, headers: authHeader(ctx.adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json().data.recaudado as { efectivo: number; transferencia: number; total: number };
  }

  // ── A. Día cerrado congela todo ────────────────────────────────────────────

  describe('A. día cerrado (RN-CAJ-21)', () => {
    it('restaurar desde papelera con el día cerrado -> 409 DAY_CLOSED y el pedido sigue en papelera', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      const trash = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authHeader(ctx.encargadoToken),
        payload: { status: 'papelera', reason: 'Cliente canceló' },
      });
      expect(trash.statusCode).toBe(200);
      await closeDay(ctx);

      const res = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/restore`, headers: authHeader(ctx.adminToken), payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('DAY_CLOSED');
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.status).toBe('papelera');
      expect(fresh.papelera_reason).toBe('Cliente canceló');
    });

    it('restaurar un pedido eliminado por el cliente con el día cerrado -> 409 DAY_CLOSED y sigue eliminado', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await app.prisma.order.update({ where: { id: order.id }, data: { client_deleted: true } });
      await closeDay(ctx);

      const res = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/restore`, headers: authHeader(ctx.adminToken), payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('DAY_CLOSED');
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.client_deleted).toBe(true);
    });

    it('mover desde papelera (drag) o mandar a papelera con el día cerrado -> 409 DAY_CLOSED', async () => {
      const ctx = await setup();
      const inTrash = await createOrder(ctx);
      await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${inTrash.id}/status`, headers: authHeader(ctx.encargadoToken),
        payload: { status: 'papelera', reason: 'Duplicado' },
      });
      const open = await createOrder(ctx);
      await closeDay(ctx);

      const fromTrash = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${inTrash.id}/status`, headers: authHeader(ctx.adminToken),
        payload: { status: 'nuevo' },
      });
      expect(fromTrash.statusCode).toBe(409);
      expect(fromTrash.json().code).toBe('DAY_CLOSED');

      const toTrash = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${open.id}/status`, headers: authHeader(ctx.adminToken),
        payload: { status: 'papelera', reason: 'Tarde' },
      });
      expect(toTrash.statusCode).toBe(409);
      expect(toTrash.json().code).toBe('DAY_CLOSED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('nuevo');
    });

    it('un pedido ya cobrado de un día cerrado: mover de estado da DAY_CLOSED (antes ORDER_LOCKED), editar también', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      expect((await cobrar(ctx, order.id, 50000)).statusCode).toBe(200);
      await closeDay(ctx);

      const move = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authHeader(ctx.adminToken),
        payload: { status: 'listo' },
      });
      expect(move.statusCode).toBe(409);
      expect(move.json().code).toBe('DAY_CLOSED');

      const edit = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { payment_method: 'transfer', payment_breakdown: { cash: 0, transfer: 50000 } },
      });
      expect(edit.statusCode).toBe(409);
      expect(edit.json().code).toBe('DAY_CLOSED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).payment_method).toBe('cash');
    });

    it('cobrar un pedido de un día cerrado -> 409 DAY_CLOSED, no queda pagado', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await closeDay(ctx);
      const res = await cobrar(ctx, order.id, 50000);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('DAY_CLOSED');
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.paid).toBe(false);
      expect(fresh.locked).toBe(false);
    });

    it('el cliente no puede eliminar desde el formulario un pedido de un día cerrado -> 409 DAY_CLOSED', async () => {
      const ctx = await setup();
      const ticket = await app.prisma.ticket.create({ data: { org_id: ctx.orgId, phone: '573009990001', customer_name: 'Cliente Ficticio Form' } });
      const url = await generateFormLinkUrl(app as any, ticket.id, ctx.orgId);
      const token = new URL(url).searchParams.get('t')!;
      const order = await app.prisma.order.create({
        data: {
          org_id: ctx.orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Ficticio Form',
          customer_phone: ticket.phone, address: 'Calle Form 1', payment_method: 'cash', source: 'form', status: 'nuevo',
          registered_by: ctx.adminId, fecha: new Date(FECHA),
          items: { create: [{ product_name: 'Mango', price: 0, sort_order: 0 }] },
        },
      });
      await closeDay(ctx);

      const res = await app.inject({
        method: 'POST', url: `/api/v1/public/order/${order.id}/delete`,
        payload: { token, device_token: 'device-ficticio' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('DAY_CLOSED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).client_deleted).toBe(false);
    });

    it('excepciones: con el día cerrado se puede marcar un crédito como pagado y agregar observaciones', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx, { payment_method: 'credito' });
      expect((await cobrar(ctx, order.id, 50000)).statusCode).toBe(200);
      await closeDay(ctx);

      const pagado = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/credito-pagado`, headers: authHeader(ctx.adminToken), payload: {} });
      expect(pagado.statusCode).toBe(200);
      expect(pagado.json().data.paid).toBe(true);

      const obs = await app.inject({
        method: 'POST', url: `/api/v1/orders/${order.id}/observations`, headers: authHeader(ctx.encargadoToken),
        payload: { text: 'Pagó el crédito al día siguiente' },
      });
      expect(obs.statusCode).toBe(201);
    });

    it('con el día abierto, restaurar desde papelera sigue funcionando igual', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authHeader(ctx.encargadoToken),
        payload: { status: 'papelera', reason: 'Por error' },
      });
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/restore`, headers: authHeader(ctx.encargadoToken), payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('nuevo');
    });
  });

  // ── C. No se cobra lo que está en papelera o eliminado ─────────────────────

  describe('C. cobro de pedidos eliminados (RN-CAJ-29)', () => {
    it('cobrar un pedido en papelera -> 409 ORDER_IN_PAPELERA, no queda pagado', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authHeader(ctx.encargadoToken),
        payload: { status: 'papelera', reason: 'Cancelado' },
      });
      const res = await cobrar(ctx, order.id, 50000);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ORDER_IN_PAPELERA');
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.paid).toBe(false);
      expect(fresh.status).toBe('papelera');
    });

    it('cobrar un pedido eliminado por el cliente -> 409 ORDER_CLIENT_DELETED, no queda pagado', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await app.prisma.order.update({ where: { id: order.id }, data: { client_deleted: true } });
      const res = await cobrar(ctx, order.id, 50000);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ORDER_CLIENT_DELETED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paid).toBe(false);
    });
  });

  // ── B. Editar un pedido ya cobrado con el día abierto ──────────────────────

  describe('B. editar un pedido ya cobrado (RN-CAJ-26 a RN-CAJ-28)', () => {
    const itemsAt = (a: number, b: number) => [
      { product_name: 'Papa Criolla', quantity_label: '2 kg', price: a, sort_order: 0 },
      { product_name: 'Cebolla Roja', quantity_label: '1 kg', price: b, sort_order: 1 },
    ];

    it('$50.000 en efectivo editado a $20.000: sin desglose -> 400 PAYMENT_BREAKDOWN_REQUIRED; con desglose -> el informe muestra $20.000 en efectivo', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      expect((await cobrar(ctx, order.id, 50000)).statusCode).toBe(200);
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 50000, transferencia: 0, total: 50000 });

      const noBreakdown = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(12000, 8000) },
      });
      expect(noBreakdown.statusCode).toBe(400);
      expect(noBreakdown.json().code).toBe('PAYMENT_BREAKDOWN_REQUIRED');
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 50000, total: 50000 });

      const ok = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(12000, 8000), payment_breakdown: { cash: 20000, transfer: 0 } },
      });
      expect(ok.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(Number(fresh.amount_received)).toBe(20000);
      expect(Number(fresh.change_amount)).toBe(0);
      expect(fresh.split_cash).toBeNull();
      expect(fresh.split_transfer).toBeNull();
      expect(fresh.paid).toBe(true);
      expect(fresh.locked).toBe(true);
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 20000, transferencia: 0, total: 20000 });

      // Historial: el cambio de productos y el del cobro quedan registrados.
      const history = await app.prisma.orderHistory.findMany({ where: { order_id: order.id } });
      expect(history.some(h => h.action_type === 'producto_modificado')).toBe(true);
      const cobroEdit = history.find(h => h.field === 'Cobro');
      expect(cobroEdit?.value_before).toContain('recibido $50.000');
      expect(cobroEdit?.value_after).toContain('recibido $20.000');
      expect(cobroEdit?.notes).toContain('Editado después de cerrado');
    });

    it('un desglose que no suma el total nuevo -> 400 PAYMENT_BREAKDOWN_MISMATCH y nada cambia', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(12000, 8000), payment_breakdown: { cash: 15000, transfer: 0 } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('PAYMENT_BREAKDOWN_MISMATCH');
      const items = await app.prisma.orderItem.findMany({ where: { order_id: order.id } });
      expect(items.reduce((s, i) => s + Number(i.price), 0)).toBe(50000);
    });

    it('cambiar el método de un pedido cobrado: encargado -> 403 PAYMENT_CHANGE_ADMIN_ONLY, domiciliario -> 403; admin sin desglose -> 400', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);

      const enc = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.encargadoToken),
        payload: { payment_method: 'transfer', payment_breakdown: { cash: 0, transfer: 50000 } },
      });
      expect(enc.statusCode).toBe(403);
      expect(enc.json().code).toBe('PAYMENT_CHANGE_ADMIN_ONLY');

      const encSoloDesglose = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.encargadoToken),
        payload: { payment_breakdown: { cash: 25000, transfer: 25000 } },
      });
      expect(encSoloDesglose.statusCode).toBe(403);

      const dom = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.domiciliarioToken),
        payload: { payment_method: 'transfer', payment_breakdown: { cash: 0, transfer: 50000 } },
      });
      expect(dom.statusCode).toBe(403);

      const admin = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { payment_method: 'transfer' },
      });
      expect(admin.statusCode).toBe(400);
      expect(admin.json().code).toBe('PAYMENT_BREAKDOWN_REQUIRED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).payment_method).toBe('cash');
    });

    it('admin pasa de efectivo a transferencia con desglose -> el informe mueve el total a transferencia', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { payment_method: 'transfer', payment_breakdown: { cash: 0, transfer: 50000 } },
      });
      expect(res.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.payment_method).toBe('transfer');
      expect(fresh.split_cash).toBeNull();
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 0, transferencia: 50000, total: 50000 });
      const history = await app.prisma.orderHistory.findMany({ where: { order_id: order.id, field: 'Método de pago' } });
      expect(history.at(-1)?.value_after).toBe('Transferencia');
    });

    it('admin corrige a pago dividido (mismo método) -> se guarda el desglose y cada parte va a su bolsa (RN-CAJ-19)', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { payment_breakdown: { cash: 30000, transfer: 20000 } },
      });
      expect(res.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(Number(fresh.split_cash)).toBe(30000);
      expect(Number(fresh.split_transfer)).toBe(20000);
      expect(Number(fresh.amount_received)).toBe(50000);
      expect(Number(fresh.change_amount)).toBe(0);
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 30000, transferencia: 20000, total: 50000 });
    });

    it('un pedido con pago dividido al que le bajan el total exige un desglose nuevo (el viejo ya no suma)', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000, { cash: 25000, transfer: 25000 });
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(10000, 10000) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('PAYMENT_BREAKDOWN_REQUIRED');
      const ok = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(10000, 10000), payment_breakdown: { cash: 5000, transfer: 15000 } },
      });
      expect(ok.statusCode).toBe(200);
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 5000, transferencia: 15000, total: 20000 });
    });

    it('no se puede pasar un pedido cobrado a crédito ni a "sin asignar" -> 400 PAYMENT_METHOD_NOT_ALLOWED', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);
      for (const m of ['credito', 'sin_asignar']) {
        const res = await app.inject({
          method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
          payload: { payment_method: m, payment_breakdown: { cash: 50000, transfer: 0 } },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('PAYMENT_METHOD_NOT_ALLOWED');
      }
    });

    it('editar solo la dirección de un pedido cobrado (con el payload que manda la web) no toca el cobro: "Recibido" se conserva', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      await cobrar(ctx, order.id, 50000);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: {
          address: 'Calle Corregida 9', payment_method: 'cash', amount_received: null, cod_choice: null,
          items: itemsAt(30000, 20000),
        },
      });
      expect(res.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(fresh.address).toBe('Calle Corregida 9');
      expect(Number(fresh.amount_received)).toBe(50000);
      expect(Number(fresh.change_amount)).toBe(0);
    });

    it('cobro en casa con vuelta: si el monto que entregó el cliente aún cubre el total nuevo, se conserva y la vuelta se recalcula', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx, { payment_method: 'cod', amount_received: 60000, cod_choice: 'vuelta' });
      expect((await cobrar(ctx, order.id, 60000)).statusCode).toBe(200);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(25000, 15000), payment_breakdown: { cash: 40000, transfer: 0 } },
      });
      expect(res.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(Number(fresh.amount_received)).toBe(60000);
      expect(Number(fresh.change_amount)).toBe(20000);
      expect(fresh.cod_choice).toBe('vuelta');
      expect(await recaudado(ctx)).toMatchObject({ efectivo: 40000, total: 40000 });
    });

    it('un crédito cerrado sin pagar: cambiar ítems no exige desglose y el monto acordado sigue al total nuevo', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx, { payment_method: 'credito' });
      await cobrar(ctx, order.id, 50000);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { items: itemsAt(20000, 10000) },
      });
      expect(res.statusCode).toBe(200);
      const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(Number(fresh.amount_received)).toBe(30000);
      expect(Number(fresh.change_amount)).toBe(0);
      expect(fresh.paid).toBe(false);
      expect(fresh.split_cash).toBeNull();
    });

    it('un desglose en un pedido aún abierto (sin cobrar) -> 400 VALIDATION_ERROR', async () => {
      const ctx = await setup();
      const order = await createOrder(ctx);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/orders/${order.id}`, headers: authHeader(ctx.adminToken),
        payload: { payment_breakdown: { cash: 50000, transfer: 0 } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });
});
