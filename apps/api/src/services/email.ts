import { config } from '../config.js';

// Resend's plain HTTP API, no SDK - same style as MetaCloudProvider (a raw
// fetch call is simpler than pulling in a dependency for one endpoint).
const RESEND_API_BASE = 'https://api.resend.com';

// resend.dev is Resend's own shared sending domain - works immediately with no
// DNS setup, but only delivers to the email address the Resend ACCOUNT itself
// is registered under. Fine for this org's current single-recipient use (2FA
// codes to staff), not for actually emailing customers - swap this for a
// verified custom domain address before sending to anyone outside the account.
const FROM_ADDRESS = 'Fruver San Gabriel <onboarding@resend.dev>';

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
