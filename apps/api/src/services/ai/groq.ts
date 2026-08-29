import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';
import { discoverCandidateModels, dropFromCache } from './modelDiscovery.js';

const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_URL = 'https://api.groq.com/openai/v1/models';

// Groq's whole platform is free-tier/rate-limited without any card on file -
// unlike OpenRouter, there's no clean "$0 = free" signal per model (most
// listed models show some per-token price, but that's irrelevant without a
// payment method attached; what actually breaks is a model getting renamed
// or retired outright - confirmed live: the original llama-3.1-8b-instant
// 404'd). So this filters to "still active, plain text-in/text-out" instead
// of trying to detect "free" by price. Excludes audio (whisper), moderation/
// safety classifiers, and Groq's own "compound" agentic wrapper models -
// none of those are a fit for a plain extraction prompt.
const SKIP_PATTERN = /guard|whisper|compound|safeguard/i;

async function getCandidates(): Promise<string[]> {
  return discoverCandidateModels('groq', {
    modelsUrl: MODELS_URL,
    headers: () => ({ Authorization: `Bearer ${config.GROQ_API_KEY}` }),
    isEligible: (m) =>
      m.active === true &&
      Array.isArray(m.input_modalities) && m.input_modalities.includes('text') &&
      Array.isArray(m.output_modalities) && m.output_modalities.includes('text') &&
      !SKIP_PATTERN.test(m.id ?? ''),
    // Confirmed working with a real request against this account (Aug 2026) -
    // tried first if Groq still lists it active.
    preferredIds: ['openai/gpt-oss-20b'],
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
    const err = await res.text().catch(() => '');
    throw new Error(`Groq API failed (${res.status}) for model ${model}: ${err}`);
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
      dropFromCache('groq', model);
    }
  }
  throw lastErr ?? new Error('Groq: ningún modelo candidato funcionó');
};
