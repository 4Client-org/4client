import { config } from '../../config.js';
import { extractWithGemini } from './gemini.js';
import { extractWithGroq } from './groq.js';
import { extractWithOpenRouter } from './openrouter.js';
import type { Extractor, ExtractedItem } from './types.js';

// "Tomar lista" (routes/inbox.ts's /parse-messages): chained free-tier AI
// providers, tried in order, each only attempted if its API key is configured.
// A deliberate prototype-phase decision (see the plan this was built from) -
// switching to a single paid provider later is just trimming this array down
// to one entry, nothing else in the codebase needs to change. Adding another
// free provider is a new file under services/ai/ (see openaiCompatible.ts's
// shared factory - most free-tier LLM APIs are OpenAI-compatible) plus one
// more entry here.
//
// Gemini is PRIMARY (fast, best JSON discipline of the three) - Groq and
// OpenRouter are the automatic fallback, re-enabled after finding LIVE that
// Gemini's free tier caps out at just 20 generateContent requests per DAY per
// model/project ("GenerateRequestsPerDayPerProjectPerModel-FreeTier", a real
// 429 hit during testing, not assumed) - way too low to rely on alone even
// for prototype-phase testing, let alone real customer traffic. Cerebras
// stays disabled (see cerebras.ts's own comment - 402 payment-required on
// every model this account can reach).
const PROVIDERS: { name: string; envKey: 'GEMINI_API_KEY' | 'GROQ_API_KEY' | 'OPENROUTER_API_KEY'; extract: Extractor }[] = [
  { name: 'gemini', envKey: 'GEMINI_API_KEY', extract: extractWithGemini },
  { name: 'groq', envKey: 'GROQ_API_KEY', extract: extractWithGroq },
  // { name: 'cerebras', envKey: 'CEREBRAS_API_KEY', extract: extractWithCerebras },
  { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', extract: extractWithOpenRouter },
];

// Speed/reliability finding (confirmed live in production logs, sep/2026):
// Gemini's free-tier "flash" family has real, recurring capacity outages
// ("high demand" 503, several times/week) - each one still costs the full
// GENERATE_TIMEOUT_MS-ish wait before this loop falls through to Groq, even
// though the SAME outage is very likely to still be happening for the next
// request that arrives a few seconds later. A short in-memory cooldown per
// provider - set only after a failure that looks like "the provider itself
// is down" (5xx, or no HTTP status at all - a network error/timeout), never
// after a normal per-request content failure (e.g. Groq's own occasional
// malformed-JSON 400, which says nothing about Groq's availability) - lets
// consecutive requests during a real outage skip straight to the next
// provider instead of re-discovering the same failure every time. Gemini
// stays first and is retried again the moment the cooldown expires, so its
// better JSON discipline is still used every time it's actually up - this
// only trims the wasted wait during the times it demonstrably isn't.
const COOLDOWN_MS = 90_000;
const cooldownUntil = new Map<string, number>();

function looksLikeProviderDown(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === undefined || status >= 500;
}

// Test-only, same pattern as modelDiscovery.ts's clearDiscoveryCache - resets
// provider cooldown state so one test's simulated outage doesn't leak into
// the next test's assertions.
export function clearProviderCooldowns(): void {
  cooldownUntil.clear();
}

export async function extractOrderItems(text: string, catalogNames: string[]): Promise<ExtractedItem[]> {
  let lastErr: unknown;
  const now = Date.now();
  for (const p of PROVIDERS) {
    if (!config[p.envKey]) continue;
    const cooldown = cooldownUntil.get(p.name);
    if (cooldown && now < cooldown) {
      console.warn(`[tomar-lista] proveedor ${p.name} en enfriamiento por ${Math.ceil((cooldown - now) / 1000)}s más, se salta`);
      continue;
    }
    try {
      const result = await p.extract(text, catalogNames);
      cooldownUntil.delete(p.name);
      return result;
    } catch (err) {
      lastErr = err;
      console.error(`[tomar-lista] proveedor ${p.name} falló, sigue al siguiente:`, err);
      if (looksLikeProviderDown(err)) cooldownUntil.set(p.name, Date.now() + COOLDOWN_MS);
    }
  }
  if (lastErr) throw new Error('Todos los proveedores de IA fallaron');
  throw new Error('Ningún proveedor de IA está configurado (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)');
}
