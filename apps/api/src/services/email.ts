import { config } from '../config.js';

// Resend's plain HTTP API, no SDK - same style as MetaCloudProvider (a raw
// fetch call is simpler than pulling in a dependency for one endpoint).
const RESEND_API_BASE = 'https://api.resend.com';

// 4client.shop is verified in Resend (SPF/DKIM) - the system's own domain,
// not the business's (fruver.com), which fits this: these are app/system
// notifications (login codes), not customer-facing messages.
const FROM_ADDRESS = '4Client <no-reply@4client.shop>';

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY no configurado');
  }
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend API falló (${res.status}): ${JSON.stringify(err)}`);
  }
}
