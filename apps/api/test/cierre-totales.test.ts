// Cierre, vista previa e informe cuadran (RN-CAJ-19, RN-CAJ-26, RN-DSH-06), solo el
// admin cierra (RN-CAJ-27, PREG-008) y el crédito guarda cuándo se pagó (RN-CAJ-28).
// Decisiones de José del 2026-10-10. Contra Postgres real, como exige el principio 11.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@4client/shared';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { bolsasDePedido, calcularBolsas, claseCierre } from '../src/lib/cierreTotals.js';

const PASS = 'CierreTotales1!';

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Mismo cálculo de "hoy" en Bogotá que cierre.ts (NOT_TODAY).
function todayColombiaStr(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

describe('regla de bolsas (lib/cierreTotals.ts) - función pura', () => {
  const base = { status: 'cerrado', paid: true, client_deleted: false, split_cash: null, split_transfer: null };

  it('pago dividido va a cada bolsa; cash/cod a efectivo; transfer a transferencia; otros a ninguna', () => {
    expect(bolsasDePedido({ ...base, payment_method: 'cash', split_cash: 30000, split_transfer: 20000, items: [{ price: 50000 }] }))
      .toEqual({ efectivo: 30000, transferencia: 20000 });
    expect(bolsasDePedido({ ...base, payment_method: 'cod', items: [{ price: 4000 }, { price: 1000 }] }))
      .toEqual({ efectivo: 5000, transferencia: 0 });
    expect(bolsasDePedido({ ...base, payment_method: 'transfer', items: [{ price: '8000.00' }] }))
      .toEqual({ efectivo: 0, transferencia: 8000 });
    expect(bolsasDePedido({ ...base, payment_method: 'credito', items: [{ price: 7000 }] }))
      .toEqual({ efectivo: 0, transferencia: 0 });
    expect(bolsasDePedido({ ...base, payment_method: 'sin_asignar', items: [{ price: 7000 }] }))
      .toEqual({ efectivo: 0, transferencia: 0 });
  });

  it('solo cuentan pagados Y cerrados que el cliente no eliminó', () => {
    const orders = [
      { ...base, payment_method: 'cash', items: [{ price: 1000 }] },
      { ...base, payment_method: 'cash', paid: false, items: [{ price: 2000 }] },
      { ...base, payment_method: 'cash', status: 'camino', items: [{ price: 4000 }] },
      { ...base, payment_method: 'cash', client_deleted: true, items: [{ price: 8000 }] },
    ];
    expect(calcularBolsas(orders)).toEqual({ efectivo: 1000, transferencia: 0, total: 1000 });
  });

  it('clasifica cada pedido sin rotular créditos sin pagar como cobrados', () => {
    expect(claseCierre({ status: 'cerrado', paid: true, client_deleted: false, payment_method: 'cash' })).toBe('cobrado');
    expect(claseCierre({ status: 'cerrado', paid: false, client_deleted: false, payment_method: 'credito' })).toBe('credito_pendiente');
    expect(claseCierre({ status: 'cerrado', paid: false, client_deleted: false, payment_method: 'cod' })).toBe('cerrado_sin_cobro');
    expect(claseCierre({ status: 'camino', paid: false, client_deleted: false, payment_method: 'cash' })).toBe('pendiente');
    expect(claseCierre({ status: 'camino', paid: true, client_deleted: false, payment_method: 'credito' })).toBe('pagado_sin_cerrar');
    expect(claseCierre({ status: 'camino', paid: false, client_deleted: true, payment_method: 'cash' })).toBe('excluido');
    expect(claseCierre({ status: 'papelera', paid: false, client_deleted: false, payment_method: 'cash' })).toBe('excluido');
  });
});

describe('cierre, vista previa e informe cuadran; solo admin cierra; crédito con fechas', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // Cada prueba que cierra "hoy" necesita su propia organización (DailyClose es
  // único por org+fecha). Tokens firmados directo: /auth/login tiene 10/min.
  async function freshOrg() {
    const org = await createTestOrg(app.prisma);
    const users: Partial<Record<UserRole, { id: string; token: string }>> = {};
    for (const role of ['admin', 'encargado', 'domiciliario', 'dev'] as UserRole[]) {
      const u = await createTestUser(app.prisma, org.id, role, PASS);
      users[role] = { id: u.id, token: app.jwt.sign({ userId: u.id, orgId: org.id, role }, { expiresIn: '15m' }) };
    }
    return { orgId: org.id, users: users as Record<UserRole, { id: string; token: string }> };
  }

  let numSeq = 100;
  async function seedOrder(orgId: string, registeredBy: string, data: Record<string, unknown>, prices: number[], fecha = todayColombiaStr()) {
    return app.prisma.order.create({
      data: {
        org_id: orgId, num: String(numSeq++).padStart(3, '0'), customer_name: 'Cliente Prueba', customer_phone: '573000000000',
        address: 'Calle Falsa 123', channel: 'call', payment_method: 'cash', status: 'nuevo', source: 'manual',
        registered_by: registeredBy, fecha: new Date(fecha),
        ...data,
        items: { create: prices.map((price, i) => ({ product_name: `Producto ${i}`, quantity_label: '1 kg', price, sort_order: i })) },
      },
    });
  }

  async function preview(token: string, fecha = todayColombiaStr()) {
    return app.inject({ method: 'GET', url: `/api/v1/cierre/preview?fecha=${fecha}`, headers: authHeader(token) });
  }
  async function dashboard(token: string, fecha = todayColombiaStr()) {
    return app.inject({ method: 'GET', url: `/api/v1/dashboard?fecha=${fecha}`, headers: authHeader(token) });
  }
  async function cerrar(token: string, decisions: Record<string, string> = {}, fecha = todayColombiaStr()) {
    return app.inject({ method: 'POST', url: '/api/v1/cierre', headers: authHeader(token), payload: { fecha, decisions } });
  }

  it('pago dividido $30.000 efectivo + $20.000 transferencia: vista previa, DailyClose e informe dicen lo mismo', async () => {
    const { orgId, users } = await freshOrg();
    const empleado = await app.prisma.employee.create({ data: { org_id: orgId, name: 'Domiciliario Split' } });
    const order = await seedOrder(orgId, users.encargado.id, { payment_method: 'cash', employee_id: empleado.id }, [35000, 15000]);

    // Cobro real (contraseña + división), como lo hace la encargada.
    const cobro = await app.inject({
      method: 'POST', url: `/api/v1/orders/${order.id}/cobro`, headers: authHeader(users.encargado.token),
      payload: { amount_received: 50000, password: PASS, split: { cash: 30000, transfer: 20000 } },
    });
    expect(cobro.statusCode).toBe(200);

    const esperado = { efectivo: 30000, transferencia: 20000, total: 50000 };

    const prev = await preview(users.admin.token);
    expect(prev.statusCode).toBe(200);
    expect(prev.json().data.totales).toEqual(esperado);
    const fila = prev.json().data.orders.find((o: any) => o.id === order.id);
    expect(fila).toMatchObject({ clase: 'cobrado', dividido: true, efectivo: 30000, transferencia: 20000, total: 50000 });

    const cierre = await cerrar(users.admin.token);
    expect(cierre.statusCode).toBe(200);
    expect(cierre.json().data).toMatchObject({ total_cash: 30000, total_transfer: 20000, total_grand: 50000 });

    const foto = await app.prisma.dailyClose.findUniqueOrThrow({ where: { org_id_fecha: { org_id: orgId, fecha: new Date(todayColombiaStr()) } } });
    expect(Number(foto.total_cash)).toBe(30000);
    expect(Number(foto.total_transfer)).toBe(20000);
    expect(Number(foto.total_grand)).toBe(50000);

    const informe = await dashboard(users.admin.token);
    expect(informe.statusCode).toBe(200);
    expect(informe.json().data.recaudado).toMatchObject(esperado);
  });

  it('día mixto: mismos números que la regla anterior del servidor, y el crédito sin pagar y el eliminado por el cliente no suman', async () => {
    const { orgId, users } = await freshOrg();
    const by = users.encargado.id;
    const cerradoPagado = { status: 'cerrado', paid: true, locked: true, paid_at: new Date(), paid_by: by };
    const cash = await seedOrder(orgId, by, { ...cerradoPagado, payment_method: 'cash' }, [6000]);
    const cod = await seedOrder(orgId, by, { ...cerradoPagado, payment_method: 'cod' }, [3000, 2000]);
    const transfer = await seedOrder(orgId, by, { ...cerradoPagado, payment_method: 'transfer' }, [8000]);
    const creditoSinPagar = await seedOrder(orgId, by, { status: 'cerrado', paid: false, locked: true, payment_method: 'credito' }, [7000]);
    const sinCobro = await seedOrder(orgId, by, { status: 'cerrado', paid: false, locked: true, payment_method: 'cod' }, [4000]);
    const eliminadoPagado = await seedOrder(orgId, by, { ...cerradoPagado, payment_method: 'cash', client_deleted: true }, [9000]);
    const eliminadoPendiente = await seedOrder(orgId, by, { status: 'nuevo', payment_method: 'cash', client_deleted: true }, [1500]);
    const papelera = await seedOrder(orgId, by, { status: 'papelera', payment_method: 'cash' }, [2500]);
    const pendiente = await seedOrder(orgId, by, { status: 'camino', payment_method: 'transfer' }, [5500]);

    // Regla anterior (cash+cod a efectivo, transfer a transferencia): 6000+5000 y 8000.
    const esperado = { efectivo: 11000, transferencia: 8000, total: 19000 };

    const prev = await preview(users.admin.token);
    expect(prev.statusCode).toBe(200);
    const data = prev.json().data;
    expect(data.totales).toEqual(esperado);
    const clase = (id: string) => data.orders.find((o: any) => o.id === id)?.clase;
    expect(clase(cash.id)).toBe('cobrado');
    expect(clase(cod.id)).toBe('cobrado');
    expect(clase(transfer.id)).toBe('cobrado');
    expect(clase(creditoSinPagar.id)).toBe('credito_pendiente');
    expect(clase(sinCobro.id)).toBe('cerrado_sin_cobro');
    expect(clase(pendiente.id)).toBe('pendiente');
    // Eliminados por el cliente y papelera ni siquiera aparecen (igual que en el informe).
    expect(clase(eliminadoPagado.id)).toBeUndefined();
    expect(clase(eliminadoPendiente.id)).toBeUndefined();
    expect(clase(papelera.id)).toBeUndefined();

    // Los pendientes de la vista previa son exactamente los que POST /cierre exige:
    // basta decidir el único pendiente (el eliminado por el cliente no se pide).
    const sinDecision = await cerrar(users.admin.token, {});
    expect(sinDecision.statusCode).toBe(400);
    expect(sinDecision.json().pending.map((p: any) => p.id)).toEqual([pendiente.id]);

    const cierre = await cerrar(users.admin.token, { [pendiente.id]: 'manana' });
    expect(cierre.statusCode).toBe(200);
    expect(cierre.json().data).toMatchObject({ total_cash: 11000, total_transfer: 8000, total_grand: 19000 });

    const informe = await dashboard(users.admin.token);
    expect(informe.json().data.recaudado).toMatchObject(esperado);
  });

  it('solo el admin (y dev) cierra la caja y ve la vista previa; encargado y domiciliario reciben 403; el estado del día sigue abierto a todos', async () => {
    const { users } = await freshOrg();

    for (const role of ['encargado', 'domiciliario'] as const) {
      const post = await cerrar(users[role].token);
      expect(post.statusCode).toBe(403);
      expect(post.json().code).toBe('FORBIDDEN');
      const prev = await preview(users[role].token);
      expect(prev.statusCode).toBe(403);
      expect(prev.json().code).toBe('FORBIDDEN');
    }

    // El 403 no cerró nada; el estado del día lo sigue leyendo el encargado (tablero).
    const status = await app.inject({ method: 'GET', url: `/api/v1/cierre/status?fecha=${todayColombiaStr()}`, headers: authHeader(users.encargado.token) });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.cerrado).toBe(false);

    expect((await preview(users.dev.token)).statusCode).toBe(200);
    expect((await cerrar(users.admin.token)).statusCode).toBe(200);
  });

  it('dev también puede cerrar la caja (requireRole deja pasar a dev, como antes)', async () => {
    const { users } = await freshOrg();
    expect((await cerrar(users.dev.token)).statusCode).toBe(200);
  });

  it('GET /cierre/preview con fecha inválida -> 400 VALIDATION_ERROR', async () => {
    const { users } = await freshOrg();
    const res = await app.inject({ method: 'GET', url: '/api/v1/cierre/preview?fecha=hoy', headers: authHeader(users.admin.token) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('crédito: guarda cuándo se pagó (credit_paid_at) sin tocar paid_at, se puede pagar con el día cerrado y no suma en ningún total (D-19)', async () => {
    const { orgId, users } = await freshOrg();
    const fecha = todayColombiaStr();
    const cerradoAt = new Date(Date.now() - 60 * 60 * 1000);
    const credito = await seedOrder(orgId, users.encargado.id, {
      status: 'cerrado', paid: false, locked: true, payment_method: 'credito', paid_at: cerradoAt, paid_by: users.encargado.id,
    }, [12000]);

    // La vista previa no lo cuenta ni lo llama "cobrado".
    const prev = await preview(users.admin.token);
    expect(prev.json().data.totales).toEqual({ efectivo: 0, transferencia: 0, total: 0 });
    expect(prev.json().data.orders.find((o: any) => o.id === credito.id).clase).toBe('credito_pendiente');

    expect((await cerrar(users.admin.token)).statusCode).toBe(200);

    // Con el día ya cerrado, el admin igual lo marca pagado.
    const antes = Date.now();
    const pagar = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${credito.id}/credito-pagado`, headers: authHeader(users.admin.token) });
    expect(pagar.statusCode).toBe(200);
    expect(pagar.json().data.credit_paid_at).toBeTruthy();

    const fresh = await app.prisma.order.findUniqueOrThrow({ where: { id: credito.id } });
    expect(fresh.paid).toBe(true);
    expect(fresh.credit_paid_at).not.toBeNull();
    expect(fresh.credit_paid_at!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(fresh.paid_at!.getTime()).toBe(cerradoAt.getTime()); // "Hora cierre" intacta

    // Informe: aparece en la pestaña Crédito con su fecha y la del pago, y no suma.
    const informe = await dashboard(users.admin.token);
    const data = informe.json().data;
    expect(data.recaudado).toMatchObject({ efectivo: 0, transferencia: 0, total: 0 });
    const enCredito = data.creditoOrders.find((o: any) => o.id === credito.id);
    expect(enCredito.paid).toBe(true);
    expect(enCredito.fecha.slice(0, 10)).toBe(fecha);
    expect(enCredito.credit_paid_at).toBeTruthy();

    // La foto del cierre no cambió.
    const foto = await app.prisma.dailyClose.findUniqueOrThrow({ where: { org_id_fecha: { org_id: orgId, fecha: new Date(fecha) } } });
    expect(Number(foto.total_grand)).toBe(0);
  });
});
