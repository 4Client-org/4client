import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

// Shared by inbox.ts's GET /:ticketId/form-link (staff clicking "Formulario") and
// webhook.ts's auto-send-after-welcome - extracted so both mint the token and reset
// the same state (form_token_min_iat, form_link_opened_at, link_failed_attempts,
// revoked/device-lock rows) exactly the same way, instead of the webhook path
// silently drifting from whatever inbox.ts does as either one gets edited later.
export async function generateFormLinkUrl(
  fastify: FastifyInstance,
  ticketId: string,
  orgId: string,
  sentByUserId?: string,
): Promise<string> {
  // Flat 24h from issuance - the token itself can never be used past this point no
  // matter what. Combined with assertLinkNotDead's own 4-hour "never opened" TTL:
  // never opened within 4h -> dead at 4h; opened within 4h -> stays valid the rest
  // of this 24h window. Was "end of the current Colombia calendar day" (so a link
  // sent at 8pm only had ~9h left) - changed because a customer opening late still
  // deserves the same full runway as one who opens right away.
  const expiresInSeconds = 24 * 60 * 60;

  const issuedAt = new Date();
  const issuedAtSec = Math.floor(issuedAt.getTime() / 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (fastify.jwt.sign as any)(
    {
      type: 'form_link',
      iat: issuedAtSec,
      ticketId,
      orgId,
      ...(sentByUserId ? { sentByUserId } : {}),
    },
    { expiresIn: expiresInSeconds },
  ) as string;

  await fastify.prisma.ticket.update({
    where: { id: ticketId },
    data: { form_token_min_iat: issuedAt, form_link_opened_at: null, link_failed_attempts: 0 },
  });
  await fastify.prisma.revokedFormToken.deleteMany({ where: { ticket_id: ticketId, org_id: orgId } });
  await fastify.prisma.formLinkSession.deleteMany({ where: { ticket_id: ticketId } });

  const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
  // Percent-encode underscores - see inbox.ts's original comment for why.
  const safeToken = token.replace(/_/g, '%5F');
  return `${frontendUrl}/form?t=${safeToken}`;
}

// Same wording/order every time a form link goes out, whether from a staff click
// or the automatic send-after-welcome. WhatsApp bold is a single asterisk on each
// side of the text (not markdown's **) - each bold paragraph below is self-
// contained (starts and ends with `*`) so it renders correctly.
export function buildFormLinkMessage(url: string): string {
  return '*ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. '
    + 'NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.*'
    + '\n\n*Este link estará activo por 4 horas. Si lo abres dentro de ese tiempo, '
    + 'quedará activo por 24 horas. Si no lo abres en las primeras 4 horas, quedará '
    + 'inactivo y deberás pedir uno nuevo.*'
    + '\n\nCuenta de ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.'
    + '\n\nLink de formulario:\n' + url;
}
