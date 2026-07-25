import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

// Shared by inbox.ts's GET /:ticketId/form-link (staff clicking "Formulario") and
// webhook.ts's auto-send-after-welcome - extracted so both mint the token and reset
// the same state (form_link_token, form_token_min_iat, form_link_opened_at,
// link_failed_attempts, revoked/device-lock rows) exactly the same way, instead of
// the webhook path silently drifting from whatever inbox.ts does as either one gets
// edited later.
//
// A short random opaque token looked up directly in the DB (public.ts), NOT a JWT -
// was a self-contained signed token (~280 chars: header+payload+signature) until a
// real customer's link got silently truncated by their phone (keyboard/clipboard/
// address bar all mangle a string that long) - one missing character breaks the
// signature and shows "link inválido" for a link that was actually fine. 20 random
// bytes hex-encoded is 40 characters, plain [0-9a-f] (no punctuation WhatsApp's
// markdown or a mobile OS could misinterpret), and just as unguessable (160 bits -
// stronger than the JWT's own HMAC secret needed to be to protect it).
const FORM_LINK_TOKEN_BYTES = 20;

export async function generateFormLinkUrl(
  fastify: FastifyInstance,
  ticketId: string,
  orgId: string,
  sentByUserId?: string,
): Promise<string> {
  const token = crypto.randomBytes(FORM_LINK_TOKEN_BYTES).toString('hex');
  const issuedAt = new Date();

  // Overwriting form_link_token IS what kills every earlier link for this ticket -
  // a lookup by the old value now matches nothing at all, no separate "superseded"
  // comparison needed anymore (see public.ts's loadTicketByFormToken).
  await fastify.prisma.ticket.update({
    where: { id: ticketId },
    data: {
      form_link_token: token,
      form_link_sent_by: sentByUserId ?? null,
      form_token_min_iat: issuedAt,
      form_link_opened_at: null,
      link_failed_attempts: 0,
    },
  });
  await fastify.prisma.revokedFormToken.deleteMany({ where: { ticket_id: ticketId, org_id: orgId } });
  await fastify.prisma.formLinkSession.deleteMany({ where: { ticket_id: ticketId } });

  const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
  return `${frontendUrl}/form?t=${token}`;
}

// Same wording/order every time a form link goes out, whether from a staff click
// or the automatic send-after-welcome. WhatsApp bold is a single asterisk on each
// side of the text (not markdown's **) - each bold paragraph below is self-
// contained (starts and ends with `*`) so it renders correctly.
//
// Sent as its OWN message, separate from the link (see webhook.ts/inbox.ts
// callers) - a single message combining this notice + bank account + the link
// made the whole block long enough that WhatsApp/mobile keyboards would sometimes
// mangle it in transit, and it meant the client couldn't forward/copy just the
// link on its own without carrying this whole notice along with it.
export function buildFormLinkWarningMessage(): string {
  return '*ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. '
    + 'NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.*'
    + '\n\n*Este link estará activo por 4 horas. Si lo abres dentro de ese tiempo, '
    + 'quedará activo por 24 horas. Si no lo abres en las primeras 4 horas, quedará '
    + 'inactivo y deberás pedir uno nuevo.*'
    + '\n\nCuenta de ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.';
}
