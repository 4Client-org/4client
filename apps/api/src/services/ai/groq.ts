import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';
import { discoverCandidateModels, dropFromCache, isPermanentModelError } from './modelDiscovery.js';

const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_URL = 'https://api.groq.com/openai/v1/models';
// Bounds each attempt so a slow/hanging candidate can't stretch the whole
// request past Railway's own upstream timeout (see gemini.ts's comment -
// found live, applies to every provider that tries multiple candidates).
const GENERATE_TIMEOUT_MS = 20_000;

// Groq's whole platform is free-tier/rate-limited without any card on file -
// unlike OpenRouter, there's no clean "$0 = free" signal per model (most
// listed models show some per-token price, but that's irrelevant without a
// payment method attached; what actually breaks is a model getting renamed
// or retired outright - confirmed live: the original llama-3.1-8b-instant
// 404'd). So this filters to "still active, plain text-in/text-out" instead
// of trying to detect "free" by price. Excludes audio (whisper), moderation/
// safety classifiers, and Groq's own "compound" agentic wrapper models -
// none of those are a fit for a plain extraction prompt.
// qwen3.6-27b and allam-2-7b confirmed live (sep/2026, real key, real
// extraction prompt): qwen3.6-27b consistently 400s ("Failed to validate
// JSON") on this exact prompt/schema (matches a real production failure),
// allam-2-7b returns valid JSON but drops items (14 of 20 in a test
// extraction) - excluded outright instead of letting live discovery keep
// re-picking either one.
const SKIP_PATTERN = /guard|whisper|compound|safeguard|qwen3\.6|allam/i;

async function getCandidates(): Promise<string[]> {
  return discoverCandidateModels('groq', {
    modelsUrl: MODELS_URL,
    headers: () => ({ Authorization: `Bearer ${config.GROQ_API_KEY}` }),
    isEligible: (m) =>
      m.active === true &&
      Array.isArray(m.input_modalities) && m.input_modalities.includes('text') &&
      Array.isArray(m.output_modalities) && m.output_modalities.includes('text') &&
      !SKIP_PATTERN.test(m.id ?? ''),
    // Los 3 confirmados con una extraccion real contra este account (Aug y
    // sep/2026) - probados en ese orden si Groq los sigue listando activos.
    // openai/gpt-oss-20b es el unico que fallo en produccion una vez (400,
    // ver groq.ts's SKIP_PATTERN de arriba para el candidato que realmente
    // causo eso) - se mantiene primero porque, probado de nuevo en vivo,
    // sigue respondiendo bien (20/20 items, ~1.5s) - esa falla puntual no se
    // repitio.
    preferredIds: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
    maxCandidates: 3,
  });
}

async function callModel(model: string, text: string, catalogNames: string[]) {
  const { system, user } = buildExtractionPrompt(text, catalogNames);
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Groq API failed (${res.status}) for model ${model}: ${body}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = await res.json() as { choices: [{ message: { content: string } }] };
  const raw = JSON.parse(stripJsonFence(data.choices[0].message.content));
  return extractedItemsSchema.parse(raw).items;
}

export const extractWithGroq: Extractor = async (text, catalogNames) => {
  const candidates = await getCandidates();
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      return await callModel(model, text, catalogNames);
    } catch (err) {
      lastErr = err;
      console.error(`[tomar-lista] groq: candidato ${model} falló:`, err);
      if (isPermanentModelError(err)) dropFromCache('groq', model);
    }
  }
  throw lastErr ?? new Error('Groq: ningún modelo candidato funcionó');
};
