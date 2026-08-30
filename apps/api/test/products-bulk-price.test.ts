import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'BulkPriceTestAdmin1!';
const ENCARGADO_PASS = 'BulkPriceTestEncargado1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// Feature 2 (Excel de precios) - lib/productExcel.ts en el frontend parsea el
// archivo y le manda a este endpoint solo {id, price_per_unit}, nunca el
// archivo en sí. Esta suite cubre el endpoint, no el parseo del Excel (eso no
// tiene test de frontend, consistente con el resto del repo).
describe('PATCH /products/bulk-price', () => {
  let app: FastifyInstance;
  let orgId: string;
  let otherOrgId: string;
  let adminToken: string;
  let encargadoToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const otherOrg = await createTestOrg(app.prisma);
    otherOrgId = otherOrg.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS);
    encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates price_per_unit for every id belonging to this org, ignores an id from another org and a nonexistent id, and reports both as notFound', async () => {
    const p1 = await app.prisma.product.create({ data: { org_id: orgId, name: 'Papa', price_per_unit: 1000 } });
    const p2 = await app.prisma.product.create({ data: { org_id: orgId, name: 'Tomate', price_per_unit: 2000 } });
    const foreign = await app.prisma.product.create({ data: { org_id: otherOrgId, name: 'De otra org', price_per_unit: 500 } });
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/products/bulk-price',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        updates: [
          { id: p1.id, price_per_unit: 1500 },
          { id: p2.id, price_per_unit: 2500 },
          { id: foreign.id, price_per_unit: 999 },
          { id: fakeId, price_per_unit: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.updated).toBe(2);
    expect(body.notFound.sort()).toEqual([fakeId, foreign.id].sort());

    const updated1 = await app.prisma.product.findUnique({ where: { id: p1.id } });
    const updated2 = await app.prisma.product.findUnique({ where: { id: p2.id } });
    const untouchedForeign = await app.prisma.product.findUnique({ where: { id: foreign.id } });
    expect(Number(updated1!.price_per_unit)).toBe(1500);
    expect(Number(updated2!.price_per_unit)).toBe(2500);
    expect(Number(untouchedForeign!.price_per_unit)).toBe(500); // never touched - different org
  });

  it('rejects an update with a negative price (schema validation, never reaches the DB)', async () => {
    const p = await app.prisma.product.create({ data: { org_id: orgId, name: 'Cebolla', price_per_unit: 800 } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/products/bulk-price',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { updates: [{ id: p.id, price_per_unit: -5 }] },
    });
    expect(res.statusCode).toBe(400);
    const unchanged = await app.prisma.product.findUnique({ where: { id: p.id } });
    expect(Number(unchanged!.price_per_unit)).toBe(800);
  });

  it('rejects a non-admin role (encargado)', async () => {
    const p = await app.prisma.product.create({ data: { org_id: orgId, name: 'Zanahoria', price_per_unit: 700 } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/products/bulk-price',
      headers: { authorization: `Bearer ${encargadoToken}` },
      payload: { updates: [{ id: p.id, price_per_unit: 999 }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty updates array', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/products/bulk-price',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { updates: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
