import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';

// WhatsApp message payload shape (subset of Meta Cloud API)
const metaMessageSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      value: z.object({
        messaging_product: z.string(),
        metadata: z.object({ phone_number_id: z.string() }).passthrough(),
        contacts: z.array(z.object({
          profile: z.object({ name: z.string() }),
          wa_id: z.string(),
        })).optional(),
        messages: z.array(z.object({
          from: z.string(),
          id: z.string(),
          timestamp: z.string(),
          type: z.string(),
          text: z.object({ body: z.string() }).optional(),
        })).optional(),
        statuses: z.array(z.unknown()).optional(),
      }).passthrough(),
      field: z.string(),
    })),
  })),
});

export default async function webhookRoutes(fastify: FastifyInstance) {
  // GET /api/v1/webhook — Meta verification handshake
  fastify.get('/', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const mode      = query['hub.mode'];
    const token     = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === config.META_WEBHOOK_VERIFY_TOKEN) {
      fastify.log.info('Webhook Meta verificado correctamente');
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: 'Token de verificación inválido' });
  });

  // POST /api/v1/webhook — incoming messages from Meta
  fastify.post('/', async (req, reply) => {
    const parsed = metaMessageSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ ok: true }); // Always 200 to Meta to avoid retries
    }

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const { contacts, messages } = change.value;
        if (!messages?.length || !contacts?.length) continue;

        for (const msg of messages) {
          if (msg.type !== 'text' || !msg.text?.body) continue;

          const phone    = msg.from;
          const name     = contacts.find(c => c.wa_id === phone)?.profile.name ?? phone;
          const text     = msg.text.body;
          const waMsgId  = msg.id;
          const sentAt   = new Date(parseInt(msg.timestamp) * 1000);

          fastify.log.info({ phone, name, text }, 'WPP mensaje entrante');

          // TODO Fase 1C: implementar lógica real
          // 1. Buscar o crear Ticket por phone + org
          // 2. Crear TicketMessage (direction: 'in')
          // 3. Actualizar ticket.last_message_at y unread_count
          // 4. Emitir socket 'ticket:message' a la org
          // Ejemplo:
          // await ingestIncomingMessage(fastify, { phone, name, text, waMsgId, sentAt, orgId });
          void [phone, name, text, waMsgId, sentAt]; // evitar lint unused hasta Fase 1C
        }
      }
    }

    // Meta requiere 200 rápido (< 20s)
    return reply.status(200).send({ ok: true });
  });
}
