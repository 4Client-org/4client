import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// cwd is the monorepo root when run via pnpm --filter api dev
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export default async function fileRoutes(fastify: FastifyInstance) {
  // POST /api/v1/files/invoice — save base64 PDF, return download URL
  fastify.post('/invoice', { preHandler: [authenticate] }, async (req, reply) => {
    const body = z.object({
      data: z.string().min(1),  // base64
      num: z.string(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos' });

    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const filename = `Factura_${body.data.num}_${id}.pdf`;
    const filepath = path.join(UPLOADS_DIR, filename);

    const buffer = Buffer.from(body.data.data, 'base64');
    fs.writeFileSync(filepath, buffer);

    const baseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return reply.status(201).send({ url: `${baseUrl}/api/v1/files/${filename}` });
  });

  // GET /api/v1/files/:filename — serve PDF file
  fastify.get('/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    // Only allow safe filenames
    if (!/^Factura_[a-zA-Z0-9_]+\.pdf$/.test(filename)) {
      return reply.status(400).send({ error: 'Archivo inválido' });
    }
    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) return reply.status(404).send({ error: 'Archivo no encontrado' });
    const stream = fs.createReadStream(filepath);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${filename}"`);
    return reply.send(stream);
  });
}
