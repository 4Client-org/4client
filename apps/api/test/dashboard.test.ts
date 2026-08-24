import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const ADMIN_PASS = 'DashboardAdmin1!';

describe('dashboard routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let adminId: string;

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

  it('"chats completados"/"con pedido activo" only count orders from the day being viewed, not the ticket\'s entire history (a ticket is now one row per phone forever)', async () => {
    const today = new Date('2026-03-05');
    const yesterday = new Date('2026-03-04');
    const phone = '573009998877';

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Informe', fecha: today, last_message_at: today },
    });

    // Today's order: fully closed - this chat should read as "completado" for today.
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Informe',
        address: 'Calle 1', payment_method: 'cash', status: 'cerrado', paid: true, locked: true,
        registered_by: adminId, fecha: today,
        items: { create: [{ product_name: 'Mango', price: 5000, sort_order: 0 }] },
      },
    });

    // An OLDER order on the same ticket (same phone, different day) that was never
    // closed - before tickets were one-per-phone-forever this simply couldn't attach
    // to today's ticket; now it lives on the same row and must NOT leak into today's count.
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Informe',
        address: 'Calle 1', payment_method: 'cash', status: 'nuevo', paid: false,
        registered_by: adminId, fecha: yesterday,
        items: { create: [{ product_name: 'Piña', price: 4000, sort_order: 0 }] },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?fecha=${today.toISOString().split('T')[0]}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);

    const { chats } = res.json().data;
    expect(chats.completos).toBe(1);
    expect(chats.activos).toBe(0);
  });

  describe('recaudado.sinCobroEfectivo/sinCobroTransferencia - pedidos cerrados "sin cobro"', () => {
    async function createOrder(overrides: Record<string, unknown>) {
      return app.prisma.order.create({
        data: {
          org_id: orgId, num: `${Math.floor(Math.random() * 100000)}`, customer_name: 'Cliente Sin Cobro',
          address: 'Calle 1', registered_by: adminId, fecha: new Date('2026-04-10'),
          items: { create: [{ product_name: 'Mango', price: 10000, sort_order: 0 }] },
          ...overrides,
        },
      });
    }

    it('a cod order closed via "cerrar sin cobro" (locked+cerrado+unpaid) shows up in sinCobroEfectivo, not in efectivo', async () => {
      await createOrder({ payment_method: 'cod', status: 'cerrado', locked: true, paid: false, customer_name: 'Rubiel' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard?fecha=2026-04-10', headers: authHeader(adminToken) });
      const { recaudado } = res.json().data;
      expect(recaudado.efectivo).toBe(0);
      expect(recaudado.sinCobroEfectivo).toEqual([{ id: expect.any(String), customer_name: 'Rubiel', total: 10000 }]);
      expect(recaudado.sinCobroTransferencia).toEqual([]);
    });

    it('a transfer order closed via "cerrar sin cobro" shows up in sinCobroTransferencia, not sinCobroEfectivo', async () => {
      await createOrder({ payment_method: 'transfer', status: 'cerrado', locked: true, paid: false, customer_name: 'Otro Cliente' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard?fecha=2026-04-10', headers: authHeader(adminToken) });
      const { recaudado } = res.json().data;
      expect(recaudado.transferencia).toBe(0);
      expect(recaudado.sinCobroTransferencia.some((o: any) => o.customer_name === 'Otro Cliente' && o.total === 10000)).toBe(true);
      expect(recaudado.sinCobroEfectivo.some((o: any) => o.customer_name === 'Otro Cliente')).toBe(false);
    });

    it('a genuinely PAID cash order never shows up in sinCobroEfectivo, even though it is also cerrado+locked', async () => {
      await createOrder({ payment_method: 'cash', status: 'cerrado', locked: true, paid: true, customer_name: 'Cliente Sí Pagó' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard?fecha=2026-04-10', headers: authHeader(adminToken) });
      const { recaudado } = res.json().data;
      expect(recaudado.sinCobroEfectivo.some((o: any) => o.customer_name === 'Cliente Sí Pagó')).toBe(false);
    });

    it('an unpaid crédito order never shows up in either sinCobro list - that is normal/expected, not a mistake to flag', async () => {
      await createOrder({ payment_method: 'credito', status: 'cerrado', locked: true, paid: false, customer_name: 'Cliente Crédito' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard?fecha=2026-04-10', headers: authHeader(adminToken) });
      const { recaudado } = res.json().data;
      expect(recaudado.sinCobroEfectivo.some((o: any) => o.customer_name === 'Cliente Crédito')).toBe(false);
      expect(recaudado.sinCobroTransferencia.some((o: any) => o.customer_name === 'Cliente Crédito')).toBe(false);
    });

    it('an order still open (not locked/cerrado) never shows up in sinCobro lists - only a genuinely closed-without-payment order should', async () => {
      await createOrder({ payment_method: 'cod', status: 'camino', locked: false, paid: false, customer_name: 'Cliente Aún Abierto' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard?fecha=2026-04-10', headers: authHeader(adminToken) });
      const { recaudado } = res.json().data;
      expect(recaudado.sinCobroEfectivo.some((o: any) => o.customer_name === 'Cliente Aún Abierto')).toBe(false);
    });
  });
});
