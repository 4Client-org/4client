import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { DEFAULT_MESSAGE_TEMPLATES, resolveMessageTemplates } from '../src/lib/messageTemplates.js';

const ADMIN_PASS = 'MsgTplAdmin1!';
const ENCARGADO_PASS = 'MsgTplEncargado1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('resolveMessageTemplates', () => {
  it('sin nada guardado devuelve los defaults', () => {
    expect(resolveMessageTemplates(null)).toEqual(DEFAULT_MESSAGE_TEMPLATES);
  });

  it('una clave guardada reemplaza solo esa; un valor vacío cae al default', () => {
    const out = resolveMessageTemplates({ bank_account: 'Nequi 300 000 0000', form_followup: '   ' });
    expect(out.bank_account).toBe('Nequi 300 000 0000');
    expect(out.form_followup).toBe(DEFAULT_MESSAGE_TEMPLATES.form_followup);
    expect(out.form_warning).toBe(DEFAULT_MESSAGE_TEMPLATES.form_warning);
  });

  it('el mínimo de domicilio y el costo quedan en el texto por defecto', () => {
    expect(DEFAULT_MESSAGE_TEMPLATES.form_followup).toContain('$10.000');
    expect(DEFAULT_MESSAGE_TEMPLATES.form_followup).toContain('$2.000');
  });
});

describe('/config/message-templates', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let encargadoToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS);
    encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET devuelve los textos efectivos, y el encargado también puede leerlos', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${encargadoToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.templates).toEqual(DEFAULT_MESSAGE_TEMPLATES);
  });

  it('el encargado no puede editar', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${encargadoToken}` },
      payload: { bank_account: 'Otra cuenta' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('el admin edita su texto y el cambio se ve en GET', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { bank_account: 'Ahorros Bancolombia: 123, a nombre de Prueba SAS.' },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${encargadoToken}` },
    });
    expect(get.json().data.templates.bank_account).toBe('Ahorros Bancolombia: 123, a nombre de Prueba SAS.');
    expect(get.json().data.templates.form_followup).toBe(DEFAULT_MESSAGE_TEMPLATES.form_followup);
  });

  it('null restaura el texto por defecto de esa clave', async () => {
    await app.inject({
      method: 'PUT', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { bank_account: null },
    });
    const get = await app.inject({
      method: 'GET', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(get.json().data.templates.bank_account).toBe(DEFAULT_MESSAGE_TEMPLATES.bank_account);
  });

  it('rechaza un texto vacío o demasiado largo', async () => {
    const vacio = await app.inject({
      method: 'PUT', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { form_warning: '   ' },
    });
    expect(vacio.statusCode).toBe(400);

    const largo = await app.inject({
      method: 'PUT', url: '/api/v1/config/message-templates',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { form_warning: 'x'.repeat(1001) },
    });
    expect(largo.statusCode).toBe(400);
  });
});
