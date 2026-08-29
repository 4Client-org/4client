// Server-side copy of apps/web/src/lib/normalize.ts's normalizeSearch - kept as
// an independent copy rather than moved into packages/shared, because that
// package is currently types-only (only re-exports *.types.ts files) and
// introducing its first runtime code for a 10-line function is a bigger
// structural change than warranted here. Keep both in sync if this ever changes.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}
