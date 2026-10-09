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

  const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
  return `${frontendUrl}/form?t=${token}`;
}


// La política vive en la propia web de 4Client (apps/web/public/legal/), en el
// mismo dominio que el formulario - antes estaba en otro repo (GitHub Pages).
// Se arma con el primer FRONTEND_URL, igual que el link del formulario, así
// cada entorno (dev/prod) apunta a su propia copia. Sin extensión .html a
// propósito: Cloudflare Pages redirige /x.html -> /x y un redirect dentro de un
// mensaje de WhatsApp es un salto de más. Una sola organización real hoy: cuando
// haya una segunda, esto pasa a leerse de Organization (política propia por negocio).
const PRIVACY_POLICY_PATH = '/legal/politica-privacidad';
function privacyPolicyUrl(): string {
  return `${config.FRONTEND_URL.split(',')[0].trim()}${PRIVACY_POLICY_PATH}`;
}

// Security-audit finding (cumplimiento Ley 1581): sin esto, no quedaba registro
// de QUÉ versión del texto de la política aceptó cada cliente - solo la fecha
// (consent_given_at/consent_confirmed_at). Si el contenido de la política
// cambia algún día, no había forma de saber si un consentimiento viejo sigue
// siendo válido para el texto nuevo. Bump manual cada vez que cambie el
// contenido de apps/web/public/legal/politica-privacidad.html.
export const PRIVACY_POLICY_VERSION = 'v1';

// Ley 1581 de 2012 - aviso de privacidad, en cursiva (sintaxis de WhatsApp:
// _texto_), pegado al FINAL del mensaje de bienvenida (ver webhook.ts) - no es
// un mensaje aparte, a propósito: sirve como prueba de que se avisó al cliente
// ANTES de que este entregue cualquier dato (nombre, dirección) por el
// formulario que se manda a continuación. El checkbox del formulario
// (ClientFormPage.tsx) sigue siendo donde se CAPTURA el consentimiento en sí -
// esto es la notificación temprana, en el chat, no un sustituto de ese checkbox.
export function buildPrivacyNoticeMessage(): string {
  // El _ de cierre va ANTES del link, no después - confirmado en una prueba
  // real que un _ pegado justo al final de la URL la rompe (queda incluido
  // como si fuera parte del link, ej. "...html_" en vez de "...html"). La
  // URL queda sin cursiva, fuera del wrapping, a propósito.
  return `_Al continuar usando este chat para tus pedidos, confirmas que conoces y aceptas nuestra Política de Privacidad:_ ${privacyPolicyUrl()}`;
}
