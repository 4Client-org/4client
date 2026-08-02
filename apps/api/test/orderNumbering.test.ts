// Gap-filling order numbering: a deferred order (cierre.ts's "mañana" decision)
// keeps its ORIGINAL num when it lands on the next day, so that day can start with
// high numbers already occupied before any of its own orders exist. These tests
// verify the smallest-unused-positive-integer algorithm (src/lib/orderNumbering.ts)
// actually fills the gaps below those carried-in numbers instead of treating them
// as a permanent floor, AND that concurrent creation never produces a duplicate or
// crossed order number - the one thing that must never happen (a customer's order
// silently taking another customer's number).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'OrderNumAdmin1!';

describe('order numbering - gap filling', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  const fecha = '2026-03-10';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: admin.email, password: ADMIN_PASS } });
    adminToken = login.json().data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOrder(overrides: Partial<{ customer_name: string }> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        customer_name: overrides.customer_name ?? 'Cliente Numeración',
        address: 'Calle Numeración 1',
        fecha,
        items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; num: string };
  }

  it('fills 1, 2, 3... on a fresh day with nothing carried in', async () => {
    const o1 = await createOrder();
    const o2 = await createOrder();
    const o3 = await createOrder();
    expect([o1.num, o2.num, o3.num]).toEqual(['001', '002', '003']);
  });

  it('skips a high number carried in from a deferred order, filling every gap below it first', async () => {
    // Simulates cierre.ts's own defer path: an order keeps its original (high) num
    // when its fecha rolls to the next day - direct Prisma insert, not via the
    // numbering function, exactly as tx.order.update in cierre.ts does.
    const deferredFecha = '2026-03-11';
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'admin' } });
    await app.prisma.order.create({
      data: {
        org_id: orgId, num: '013', customer_name: 'Pospuesto', customer_phone: '573000000013',
        address: 'Calle Pospuesta 1', channel: 'whatsapp', payment_method: 'cash', status: 'nuevo', source: 'manual',
        registered_by: admin.id, fecha: new Date(deferredFecha),
        items: { create: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
      },
    });

    const nums: string[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { customer_name: `Cliente ${i}`, address: 'Calle X', fecha: deferredFecha, items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
      });
      expect(res.statusCode).toBe(201);
      nums.push(res.json().data.num);
    }
    // 1 through 12 fill first - 013 is already taken by the deferred order.
    expect(nums).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012']);

    // The 13th new order must skip the taken 013 and land on 014, not collide with
    // the deferred order and never reuse its number.
    const next = await app.inject({
      method: 'POST', url: '/api/v1/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { customer_name: 'Cliente Final', address: 'Calle X', fecha: deferredFecha, items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
    });
    expect(next.statusCode).toBe(201);
    expect(next.json().data.num).toBe('014');
  });

  it('a deferred order landing on num 001 pushes the next new order to 002, not left unused', async () => {
    const deferredFecha = '2026-03-12';
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'admin' } });
    await app.prisma.order.create({
      data: {
        org_id: orgId, num: '001', customer_name: 'Pospuesto Uno', customer_phone: '573000000001',
        address: 'Calle Pospuesta 1', channel: 'whatsapp', payment_method: 'cash', status: 'nuevo', source: 'manual',
        registered_by: admin.id, fecha: new Date(deferredFecha),
        items: { create: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { customer_name: 'Cliente Nuevo', address: 'Calle X', fecha: deferredFecha, items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.num).toBe('002');
  });

  it('multiple gaps (13 and 24 both carried in) fill 1-12, then 14-23, then 25 - never touching 13 or 24', async () => {
    const deferredFecha = '2026-03-13';
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'admin' } });
    for (const num of ['013', '024']) {
      await app.prisma.order.create({
        data: {
          org_id: orgId, num, customer_name: `Pospuesto ${num}`, customer_phone: `57300000${num}`,
          address: 'Calle Pospuesta', channel: 'whatsapp', payment_method: 'cash', status: 'nuevo', source: 'manual',
          registered_by: admin.id, fecha: new Date(deferredFecha),
          items: { create: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
        },
      });
    }
    const nums: string[] = [];
    for (let i = 0; i < 23; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { customer_name: `Cliente ${i}`, address: 'Calle X', fecha: deferredFecha, items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
      });
      expect(res.statusCode).toBe(201);
      nums.push(res.json().data.num);
    }
    const expected = [
      '001','002','003','004','005','006','007','008','009','010','011','012',
      '014','015','016','017','018','019','020','021','022','023','025',
    ];
    expect(nums).toEqual(expected);
    expect(nums).not.toContain('013');
    expect(nums).not.toContain('024');
  });

  it('concurrent order creation on the same day never produces a duplicate or crossed number', async () => {
    const concurrentFecha = '2026-03-14';
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        app.inject({
          method: 'POST', url: '/api/v1/orders',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { customer_name: `Cliente Concurrente ${i}`, address: 'Calle Concurrente', fecha: concurrentFecha, items: [{ product_name: 'Mango', quantity_label: '1 kg', price: 3000, sort_order: 0 }] },
        }),
      ),
    );
    for (const res of results) expect(res.statusCode).toBe(201);
    const nums = results.map(r => r.json().data.num);
    const uniqueNums = new Set(nums);
    // No two concurrent requests ever landed on the same number - the DB's own
    // unique constraint plus the retry loop guarantee this, this just proves it
    // holds under real concurrency, not just in the single-threaded tests above.
    expect(uniqueNums.size).toBe(nums.length);

    // Every customer's order kept ITS OWN items/customer_name under its own num -
    // no cross-assignment happened as a side effect of the numbering retries.
    const orders = await app.prisma.order.findMany({ where: { org_id: orgId, fecha: new Date(concurrentFecha) }, select: { num: true, customer_name: true } });
    const byNum = new Map(orders.map(o => [o.num, o.customer_name]));
    for (let i = 0; i < 15; i++) {
      const expectedName = `Cliente Concurrente ${i}`;
      const num = nums[i];
      expect(byNum.get(num)).toBe(expectedName);
    }
  });
});
