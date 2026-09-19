import { normalizeSearch } from './normalize.js';

// Matches a raw product name (as extracted by the "Tomar lista" AI flow, see
// services/ai/index.ts) against the org's real catalog. First-pass heuristic
// for the prototype phase - tune the thresholds below with real usage data,
// not a claim of correctness for every possible product name.

export interface CatalogEntry {
  name: string;
}

export interface MatchResult {
  matched: boolean;
  // The catalog's own name when matched (so the order item shows the real
  // product name, not whatever variant the AI/client typed); the raw AI text
  // as-is when unmatched (nothing better to show).
  name: string;
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

// price_per_unit is NEVER read here (security-audit-style fix, same rule
// applied to the public form and the manual "crear pedido" flow already):
// this function only resolves a NAME against the catalog. The caller
// (inbox.ts's /parse-messages) always starts every drafted item's price at 0,
// matched or not - staff types the real price by hand, always, no exceptions.
// Security-audit finding (deep-profile, live-measured): el costo de Levenshtein
// de más abajo escala con el largo de `raw` por cada entrada del catálogo -
// medido en vivo, ~10s con un string de 1M caracteres contra 63 productos.
// Hoy el único llamador real (inbox.ts's /parse-messages) ya limita `raw` a
// 200 caracteres vía el schema de extracción de IA, pero esa cota vive en un
// archivo totalmente distinto - esta función no debe depender de eso para ser
// segura. Cualquier cosa más larga que un nombre de producto real nunca va a
// calzar de todas formas, así que se devuelve sin coincidencia de una vez.
const MAX_MATCH_INPUT_LENGTH = 200;

export function matchProductName(raw: string, catalog: CatalogEntry[]): MatchResult {
  if (raw.length > MAX_MATCH_INPUT_LENGTH) return { matched: false, name: raw };
  const rawNorm = normalizeForMatch(raw);
  const entries = catalog.map(c => ({ ...c, norm: normalizeForMatch(c.name) }));

  // 1. Exact normalized match.
  const exact = entries.find(e => e.norm === rawNorm);
  if (exact) return { matched: true, name: exact.name };

  // 2. Substring containment, only if exactly one catalog product qualifies -
  // an ambiguous hit (e.g. "papa" matching both "Papa criolla" and "Papa
  // pastusa") must not guess, it falls through to fuzzy matching instead.
  const substringHits = entries.filter(e => e.norm.includes(rawNorm) || rawNorm.includes(e.norm));
  if (substringHits.length === 1) {
    return { matched: true, name: substringHits[0].name };
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
      return { matched: true, name: best.e.name };
    }
  }

  // 4. No confident match - surface the raw AI text as-is for staff to review.
  return { matched: false, name: raw };
}
