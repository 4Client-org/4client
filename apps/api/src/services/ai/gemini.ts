import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';
import { discoverCandidateModels, dropFromCache } from './modelDiscovery.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Google's /models response is NOT OpenAI-shaped like Groq/OpenRouter -
// `{ models: [{ name: "models/gemini-x", supportedGenerationMethods: [...] }] }`,
// id lives under `name` (which already includes the "models/" prefix needed
// to build the generateContent URL below, so it's used as-is, not stripped).
//
// No hardcoded "known good" model here (unlike groq.ts/openrouter.ts) - this
// was set up without a working Gemini key to test against live, so there's
// nothing proven yet to prefer. Filters to models that actually support
// generateContent and aren't obviously the wrong kind (embeddings, image/
// video/audio generation, etc.) and tries a few candidates in order. If the
// very first real request reveals a better model to prefer, add it to
// PREFERRED_IDS below rather than re-deriving this from scratch.
const PREFERRED_IDS: string[] = [];
const SKIP_PATTERN = /embedding|aqa|vision|imagen|veo|tts|audio/i;

async function getCandidates(): Promise<string[]> {
  return discoverCandidateModels('gemini', {
    modelsUrl: `${API_BASE}/models?key=${config.GEMINI_API_KEY}`,
    headers: () => ({}),
    extractList: (data) => data.models ?? [],
    getId: (m) => m.name,
    isEligible: (m) =>
      typeof m.name === 'string' &&
      Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') &&
      !SKIP_PATTERN.test(m.name),
    preferredIds: PREFERRED_IDS,
    maxCandidates: 4,
  });
}

async function callModel(modelName: string, text: string, catalogNames: string[]) {
  const { system, user } = buildExtractionPrompt(text, catalogNames);
  const res = await fetch(`${API_BASE}/${modelName}:generateContent?key=${config.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      // responseMimeType alone, no responseSchema - keeps this closer to the
      // other providers' "ask nicely + validate on the way out with zod" (the
      // schema route needs its own OBJECT/ARRAY-typed definition that hasn't
      // been tested against a real key yet; add it once this path is
      // confirmed working, not before).
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API failed (${res.status}) for model ${modelName}: ${err}`);
  }
  const data = await res.json() as { candidates: [{ content: { parts: [{ text: string }] } }] };
  const raw = JSON.parse(stripJsonFence(data.candidates[0].content.parts[0].text));
  return extractedItemsSchema.parse(raw).items;
}

export const extractWithGemini: Extractor = async (text, catalogNames) => {
  const candidates = await getCandidates();
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      return await callModel(model, text, catalogNames);
    } catch (err) {
      lastErr = err;
      dropFromCache('gemini', model);
    }
  }
  throw lastErr ?? new Error('Gemini: ningún modelo candidato funcionó');
};
