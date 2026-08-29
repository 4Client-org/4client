import { config } from '../../config.js';
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
// Gemini was dropped entirely (Google now requires billing/a card just to
// issue a key). Cerebras is NOT currently in this chain either - its module
// still exists and works (cerebras.ts), but every model on this account's
// free trial now 402s "payment required" (confirmed live, not assumed) - see
// cerebras.ts's comment for exactly what to try if that ever changes; adding
// it back is uncommenting one line below. Groq and OpenRouter (its one
// `:free` model that's actually still free AND doesn't require a card) are
// both confirmed genuinely free with a real request as of this fix.
const PROVIDERS: { name: string; envKey: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY'; extract: Extractor }[] = [
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
  throw new Error('Ningún proveedor de IA está configurado (GROQ_API_KEY / OPENROUTER_API_KEY)');
}
