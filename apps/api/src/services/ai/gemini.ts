import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';
import { discoverCandidateModels, dropFromCache, isPermanentModelError } from './modelDiscovery.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Every network call here has an explicit timeout (AbortSignal.timeout) -
// found the hard way that without one, a single slow/hanging candidate model
// could stretch one "Tomar lista" request past Railway's own upstream
// timeout, which returns a 502 to the browser while the server keeps working
// in the background on a connection nobody's listening on anymore (looked to
// staff like the "Montar lista" button just froze forever). Bounding each
// attempt keeps the worst case (all candidates slow/dead) a fixed, known
// multiple of these numbers instead of open-ended.
const MODELS_TIMEOUT_MS = 10_000;
// Bajado de 20s a 12s (y ver maxCandidates más abajo) - confirmado en vivo
// (sep/2026, con la key real, pidiendo una extracción de tamaño real) que
// Google está teniendo congestión real en TODA la familia "flash" ahora
// mismo (503 "This model is currently experiencing high demand" incluso en
// modelos nuevos como gemini-3.7-flash) - no es un modelo puntual roto, es
// capacidad del lado de Google. Cuando pasa, tarda varios segundos en
// devolver el 503 (no es instantáneo) - un timeout más corto deja mas
// margen para que Groq (confirmado igual de rápido y confiable, ver
// groq.ts) rescate la petición dentro del tiempo que el navegador/Railway
// están dispuestos a esperar, en vez de quemar el presupuesto completo
// reintentando un proveedor que hoy está lento.
const GENERATE_TIMEOUT_MS = 12_000;

// Google's /models response is NOT OpenAI-shaped like Groq/OpenRouter -
// `{ models: [{ name: "models/gemini-x", supportedGenerationMethods: [...] }] }`,
// id lives under `name` (which already includes the "models/" prefix needed
// to build the generateContent URL below, so it's used as-is, not stripped).
//
// gemini-2.5-flash (this account's first candidate before this fix) turned
// out to 404 outright ("no longer available to new users... use
// models/gemini-3.6-flash instead" - Google's own error message named the
// replacement). gemini-3.6-flash confirmed working with a real request
// (Aug 2026) - both facts found live, not assumed, same discipline as
// groq.ts/openrouter.ts. Excludes model families that are never a fit for a
// plain text-in/JSON-out extraction prompt (image/video/audio generation,
// embeddings, agentic/tool-use previews, research assistants) - a bad pick
// here just fails and falls through to the next candidate like any other
// failure, this just avoids wasting an attempt on an obvious mismatch.
const PREFERRED_IDS = ['models/gemini-3.6-flash'];
const SKIP_PATTERN = /embedding|aqa|vision|imagen|veo|tts|audio|transcribe|image|robotics|computer-use|deep-research|lyria|customtools|antigravity|nano-banana/i;

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
    // Bajado de 3 a 1 - confirmado en vivo (sep/2026) que los otros 2
    // candidatos que la lista en vivo venia agregando (gemini-2.5-flash,
    // gemini-2.5-pro) siguen 404 "no longer available to new users", no es
    // algo que se vaya a arreglar solo. Reintentarlos solo suma dos llamadas
    // que fallan rapido (ver isPermanentModelError) pero igual restan tiempo
    // - con un solo candidato conocido-bueno, un fallo cae directo a Groq.
    maxCandidates: 1,
  });
}

async function callModel(modelName: string, text: string, catalogNames: string[]) {
  const { system, user } = buildExtractionPrompt(text, catalogNames);
  const res = await fetch(`${API_BASE}/${modelName}:generateContent?key=${config.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      // responseMimeType alone, no responseSchema - keeps this closer to the
      // other providers' "ask nicely + validate on the way out with zod" (the
      // schema route needs its own OBJECT/ARRAY-typed definition that hasn't
      // been tested against a real key yet; add it once this path is
      // confirmed working, not before).
      //
      // thinkingConfig.thinkingBudget: 1 - Gemini's "thinking" models spend a
      // large chunk of their output budget on internal reasoning before ever
      // writing the actual answer (confirmed live: a small 4-item extraction
      // used 566 "thought" tokens vs ~60 real ones, ~11s total; a 24-item one
      // used 1339 thought tokens, ~7.7s). Pure JSON extraction against a
      // known catalog doesn't need multi-step reasoning - budget 1 (not 0,
      // which this model rejects with a 400) eliminates virtually all of it:
      // same 24-item test dropped to ~6.3s and roughly half the total tokens,
      // with identical output. Some fallback candidates may not support this
      // field at all and 400 on it - that's fine, same as any other
      // candidate failure, falls through to the next one.
      generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 1 } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini API failed (${res.status}) for model ${modelName}: ${body}`) as Error & { status: number };
    err.status = res.status;
    throw err;
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
      console.error(`[tomar-lista] gemini: candidato ${model} falló:`, err);
      if (isPermanentModelError(err)) dropFromCache('gemini', model);
    }
  }
  throw lastErr ?? new Error('Gemini: ningún modelo candidato funcionó');
};
