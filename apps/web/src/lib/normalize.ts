// Accent/case-insensitive search matching, shared by every search box in the app
// (client form's product search, staff's catalog/factbox search, the board's
// ticket/order search) - "aguacate", "Aguacate" and "AGUACATE" must all match a
// product typed as "Aguacate", regardless of how either side capitalizes or
// accents things. NFD + stripping combining diacritical marks (̀-ͯ)
// separates a base letter from its accent mark so the accent can be dropped
// without touching the letter itself.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}
