// A WhatsApp Business-Scoped User ID (BSUID, format "CC.<alphanumeric>" - see
// meta-cloud.ts's toOrRecipient, the other place this exact shape is checked) or
// our own "no-<hex>" placeholder (webhook.ts, a message that arrived with no
// identifier at all) are never real phone numbers - showing either raw just
// looked like a garbled/wrong number to staff, with nothing indicating this is
// expected. Neither can ever be translated into a real callable number - that's
// deliberate on Meta's side, the whole point of WhatsApp usernames is to NOT
// hand the business a phone number.
const BSUID_RE = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/;
export function looksFake(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return BSUID_RE.test(phone) || phone.startsWith('no-');
}

// WhatsApp/Meta numbers are always stored with the country code (57 + 10-digit
// Colombian mobile, e.g. "573001234567") since that's the format Meta's API sends
// and expects. Staff never dial the +57 themselves and don't need to see it - only
// strip it when the shape actually matches (12 digits starting with 57), so a
// number that's some other format (already local, a different country) is left
// alone instead of getting mangled.
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone || looksFake(phone)) return 'Sin teléfono';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) return digits.slice(2);
  return phone;
}
