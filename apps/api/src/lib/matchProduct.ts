import { normalizeSearch } from './normalize.js';

// Matches a raw product name (as extracted by the "Tomar lista" AI flow, see
// services/ai/index.ts) against the org's real catalog. First-pass heuristic
// for the prototype phase - tune the thresholds below with real usage data,
// not a claim of correctness for every possible product name.

export interface CatalogEntry {
  name: string;
  price_per_unit: number | null;
}

export interface MatchResult {
  matched: boolean;
  // The catalog's own name when matched (so the order item shows the real
  // product name, not whatever variant the AI/client typed); the raw AI text
  // as-is when unmatched (nothing better to show).
  name: string;
  price: number;
}

// Scoped to this file only - NOT the same normalization used for search boxes
// elsewhere (normalizeSearch itself is unchanged). Naive: strips a trailing
// "es" or "s" from words longer than 4/3 chars respectively, so "tomates"/
// "cebollas" can match a catalog singular "Tomate"/"Cebolla" without dragging
// in a real stemming library for one heuristic step.
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function normalizeForMatch(value: string): string {
  return normalizeSearch(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(' ');
}

// Plain Levenshtein edit distance (insert/delete/substitute), no library -
// short product names, this is a handful of characters, not worth a dependency.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const FUZZY_THRESHOLD = 0.72;
const FUZZY_MARGIN = 0.08;

export function matchProductName(raw: string, catalog: CatalogEntry[]): MatchResult {
  const rawNorm = normalizeForMatch(raw);
  const entries = catalog.map(c => ({ ...c, norm: normalizeForMatch(c.name) }));

  const priceOf = (p: number | null): number => p ?? 0;

  // 1. Exact normalized match.
  const exact = entries.find(e => e.norm === rawNorm);
  if (exact) return { matched: true, name: exact.name, price: priceOf(exact.price_per_unit) };

  // 2. Substring containment, only if exactly one catalog product qualifies -
  // an ambiguous hit (e.g. "papa" matching both "Papa criolla" and "Papa
  // pastusa") must not guess, it falls through to fuzzy matching instead.
  const substringHits = entries.filter(e => e.norm.includes(rawNorm) || rawNorm.includes(e.norm));
  if (substringHits.length === 1) {
    const e = substringHits[0];
    return { matched: true, name: e.name, price: priceOf(e.price_per_unit) };
  }

  // 3. Fuzzy match by edit-distance similarity - only if the best candidate
  // clears the threshold AND beats the runner-up by a real margin (no
  // coin-flip winner between two similarly-close products).
  const scored = entries
    .map(e => ({ e, score: similarity(rawNorm, e.norm) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    const best = scored[0];
    const second = scored[1];
    const marginOk = !second || best.score - second.score >= FUZZY_MARGIN;
    if (best.score >= FUZZY_THRESHOLD && marginOk) {
      return { matched: true, name: best.e.name, price: priceOf(best.e.price_per_unit) };
    }
  }

  // 4. No confident match - surface the raw AI text as-is for staff to review.
  return { matched: false, name: raw, price: 0 };
}
