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

export async function extractOrderItems(text: string, catalogNames: string[]): Promise<ExtractedItem[]> {
  let lastErr: unknown;
  for (const p of PROVIDERS) {
    if (!config[p.envKey]) continue;
    try {
      return await p.extract(text, catalogNames);
    } catch (err) {
      lastErr = err;
      console.error(`[tomar-lista] proveedor ${p.name} falló, sigue al siguiente:`, err);
    }
  }
  if (lastErr) throw new Error('Todos los proveedores de IA fallaron');
  throw new Error('Ningún proveedor de IA está configurado (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)');
}
