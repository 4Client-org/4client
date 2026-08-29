import { config } from '../../config.js';
import { extractWithGroq } from './groq.js';
import { extractWithGemini } from './gemini.js';
import { extractWithCerebras } from './cerebras.js';
import type { Extractor, ExtractedItem } from './types.js';

// "Tomar lista" (routes/inbox.ts's /parse-messages): chained free-tier AI
// providers, tried in order, each only attempted if its API key is configured.
// A deliberate prototype-phase decision (see the plan this was built from) -
// switching to a single paid provider later is just trimming this array down
// to one entry, nothing else in the codebase needs to change.
const PROVIDERS: { name: string; envKey: 'GROQ_API_KEY' | 'GEMINI_API_KEY' | 'CEREBRAS_API_KEY'; extract: Extractor }[] = [
  { name: 'groq', envKey: 'GROQ_API_KEY', extract: extractWithGroq },
  { name: 'gemini', envKey: 'GEMINI_API_KEY', extract: extractWithGemini },
  { name: 'cerebras', envKey: 'CEREBRAS_API_KEY', extract: extractWithCerebras },
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
  throw new Error('Ningún proveedor de IA está configurado (GROQ_API_KEY / GEMINI_API_KEY / CEREBRAS_API_KEY)');
}
