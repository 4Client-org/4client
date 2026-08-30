import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';
import { discoverCandidateModels, dropFromCache } from './modelDiscovery.js';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
// Bounds each attempt so a slow/hanging candidate can't stretch the whole
// request past Railway's own upstream timeout (see gemini.ts's comment -
// found live, applies to every provider that tries multiple candidates).
const GENERATE_TIMEOUT_MS = 20_000;

// OpenRouter's own /models response includes real pricing per model, so
// "free" is actually detectable here (unlike Groq) - `:free`-suffixed id AND
// $0 prompt/completion cost. That roster churns constantly (confirmed live:
// the very first model picked for this, meta-llama/llama-3.1-8b-instruct:free,
// was already retired from the free tier by the time this got tested for
// real) - querying it live instead of hardcoding one id is the actual fix.
// Excludes ids that are clearly narrow-purpose even though they qualify as
// free (safety classifiers, code-only models) - best-effort by name, not
// exhaustive; a bad pick here just fails its own request and falls through
// to the next candidate like any other failure.
const SKIP_PATTERN = /safety|guard|code|note-preview/i;

async function getCandidates(): Promise<string[]> {
  return discoverCandidateModels('openrouter', {
    modelsUrl: MODELS_URL,
    headers: () => ({ Authorization: `Bearer ${config.OPENROUTER_API_KEY}` }),
    isEligible: (m) =>
      typeof m.id === 'string' && m.id.endsWith(':free') &&
      Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 &&
      !SKIP_PATTERN.test(m.id),
    // Confirmed working with a real request (Aug 2026) - tried first if
    // OpenRouter still lists it free.
    preferredIds: ['inclusionai/ling-3.0-flash-fin:free'],
    maxCandidates: 4,
  });
}

async function callModel(model: string, text: string, catalogNames: string[]) {
  const { system, user } = buildExtractionPrompt(text, catalogNames);
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Deliberately NOT sending response_format - confirmed live that at
      // least one free model 400s on it ("does not support feature:
      // structured-outputs"), and there's no way to know in advance which of
      // the ever-changing free roster does or doesn't support it. Prompt-only
      // JSON, same as before, still validated by zod on the way out.
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenRouter API failed (${res.status}) for model ${model}: ${err}`);
  }
  const data = await res.json() as { choices: [{ message: { content: string } }] };
  const raw = JSON.parse(stripJsonFence(data.choices[0].message.content));
  return extractedItemsSchema.parse(raw).items;
}

export const extractWithOpenRouter: Extractor = async (text, catalogNames) => {
  const candidates = await getCandidates();
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      return await callModel(model, text, catalogNames);
    } catch (err) {
      lastErr = err;
      dropFromCache('openrouter', model);
    }
  }
  throw lastErr ?? new Error('OpenRouter: ningún modelo gratis candidato funcionó');
};
