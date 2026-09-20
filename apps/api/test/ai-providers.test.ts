import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { extractOrderItems, clearProviderCooldowns } from '../src/services/ai/index.js';
import { clearDiscoveryCache } from '../src/services/ai/modelDiscovery.js';

// config is a plain mutable object (see config.ts) - tests set/delete keys
// directly per case instead of needing separate env-var-injection infra.
// Gemini -> Groq -> OpenRouter is the active chain (index.ts) - Cerebras stays
// out (every model on the free trial 402s on this account), so no tests for
// it beyond confirming its key alone has no effect.
const ORIGINAL = {
  gemini: config.GEMINI_API_KEY,
  groq: config.GROQ_API_KEY,
  openrouter: config.OPENROUTER_API_KEY,
};

function clearKeys() {
  delete (config as any).GEMINI_API_KEY;
  delete (config as any).GROQ_API_KEY;
  delete (config as any).CEREBRAS_API_KEY;
  delete (config as any).OPENROUTER_API_KEY;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

// Gemini's /models and generateContent response shapes (see gemini.ts) -
// different from the OpenAI-style {choices:[...]} Groq/OpenRouter use.
// gemini.ts's maxCandidates is 1 (bajado de 3 - ver el comentario en
// gemini.ts: los otros 2 candidatos que la discovery en vivo agregaba
// (gemini-2.5-flash/-pro) están confirmados muertos, 404 permanente) - solo
// gemini-2.5-flash (el único preferredId que calza contra esta lista
// simulada) llega a intentarse nunca un segundo candidato dentro de gemini
// mismo en estos tests.
const geminiModelsBody = {
  models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ],
};
const geminiChatBody = (items: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] });

// Groq and OpenRouter are both OpenAI-compatible - same {data:[...]} /models
// shape and {choices:[{message:{content}}]} chat shape. Groq's maxCandidates
// sigue en 3 - acá es donde el comportamiento "un candidato falla, prueba el
// siguiente DENTRO del mismo proveedor" sigue aplicando de verdad.
const groqModelsBody = {
  data: [
    { id: 'openai/gpt-oss-20b', active: true, input_modalities: ['text'], output_modalities: ['text'] },
    { id: 'openai/gpt-oss-120b', active: true, input_modalities: ['text'], output_modalities: ['text'] },
  ],
};
const openrouterModelsBody = { data: [{ id: 'inclusionai/ling-3.0-flash-fin:free', pricing: { prompt: '0', completion: '0' } }] };
const chatBody = (items: unknown) => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] });

describe('extractOrderItems (services/ai/index.ts provider fallback)', () => {
  beforeEach(() => {
    clearKeys();
    clearDiscoveryCache();
    clearProviderCooldowns();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (config as any).GEMINI_API_KEY = ORIGINAL.gemini;
    (config as any).GROQ_API_KEY = ORIGINAL.groq;
    (config as any).OPENROUTER_API_KEY = ORIGINAL.openrouter;
    vi.useRealTimers();
  });

  it('no provider configured -> throws immediately without calling fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    await expect(extractOrderItems('quiero papa', ['Papa'])).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setting CEREBRAS_API_KEY alone has no effect (not in the active chain)', async () => {
    (config as any).CEREBRAS_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch');
    await expect(extractOrderItems('quiero papa', ['Papa'])).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Gemini configured alone -> discovers its model list, calls a generateContent-capable candidate', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      return jsonResponse(geminiChatBody([{ product_name: 'papa', quantity_label: '1 kg' }]));
    });
    const items = await extractOrderItems('quiero papa', ['Papa']);
    expect(items).toEqual([{ product_name: 'papa', quantity_label: '1 kg' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const chatCall = fetchSpy.mock.calls.find(c => !String(c[0]).includes('/models?'))!;
    expect(String(chatCall[0])).toContain('generativelanguage.googleapis.com');
    expect(String(chatCall[0])).not.toContain('embedding');
  });

  it('Gemini: its one candidate fails -> falls through to Groq without trying a 2nd Gemini model', async () => {
    // gemini.ts's maxCandidates es 1 - confirmado en vivo (sep/2026) que los
    // otros 2 candidatos que la discovery encontraba (gemini-2.5-flash/-pro)
    // están muertos (404 permanente) y solo desperdiciaban tiempo antes de
    // caer a Groq, que resultó igual de confiable y más rápido.
    (config as any).GEMINI_API_KEY = 'gemini-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) return jsonResponse({}, false, 404);
      if (u.includes('gemini-2.5-pro:')) return jsonResponse(geminiChatBody([{ product_name: 'NO debería llegar aquí', quantity_label: '' }]));
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      return jsonResponse(chatBody([{ product_name: 'tomate', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero tomate', ['Tomate']);
    expect(items).toEqual([{ product_name: 'tomate', quantity_label: '' }]);
    const geminiChatCalls = fetchSpy.mock.calls.filter(c => String(c[0]).includes('generativelanguage.googleapis.com') && !String(c[0]).includes('/models?'));
    expect(geminiChatCalls.length).toBe(1); // solo gemini-2.5-flash, nunca gemini-2.5-pro
  });

  it('Groq: first discovered candidate fails -> tries the next one within Groq itself', async () => {
    // A diferencia de Gemini (ver arriba), Groq sí mantiene varios candidatos
    // (maxCandidates: 3) - sus modelos activos rotan con más frecuencia y,
    // confirmado en vivo (sep/2026), un candidato puntual puede fallar
    // (400 "Failed to validate JSON") mientras otro funciona bien - vale la
    // pena reintentar dentro del mismo proveedor antes de caer a OpenRouter.
    (config as any).GROQ_API_KEY = 'groq-key';
    // Groq no mete el nombre del modelo en la URL (a diferencia de Gemini) -
    // se distingue el 1er intento del 2do por orden de llamada, no por URL.
    let chatCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(groqModelsBody);
      chatCalls++;
      if (chatCalls === 1) return jsonResponse({}, false, 400); // 1er candidato falla
      return jsonResponse(chatBody([{ product_name: 'papa', quantity_label: '2 kg' }])); // 2do candidato funciona
    });
    const items = await extractOrderItems('quiero papa', ['Papa']);
    expect(items).toEqual([{ product_name: 'papa', quantity_label: '2 kg' }]);
    expect(chatCalls).toBe(2);
  });

  it('Gemini fails entirely (e.g. daily quota, confirmed live as a real failure mode) -> falls through to Groq', async () => {
    (config as any).GEMINI_API_KEY = 'gemini-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('generativelanguage.googleapis.com')) return jsonResponse({}, false, 429); // quota exhausted
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      return jsonResponse(chatBody([{ product_name: 'cebolla', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero cebolla', ['Cebolla']);
    expect(items).toEqual([{ product_name: 'cebolla', quantity_label: '' }]);
    // Gemini tries its (only) candidate, fails - Groq then succeeds on its first.
    const groqCalls = fetchSpy.mock.calls.filter(c => String(c[0]).includes('groq.com'));
    expect(groqCalls.length).toBe(2); // 1 models + 1 chat
  });

  it('Gemini and Groq both fail -> falls through to OpenRouter', async () => {
    (config as any).GEMINI_API_KEY = 'gemini-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('generativelanguage.googleapis.com')) return jsonResponse({}, false, 429);
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      if (u.includes('groq.com')) return jsonResponse({}, false, 500);
      if (u.includes('openrouter.ai/api/v1/models')) return jsonResponse(openrouterModelsBody);
      return jsonResponse(chatBody([{ product_name: 'zanahoria', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero zanahoria', ['Zanahoria']);
    expect(items).toEqual([{ product_name: 'zanahoria', quantity_label: '' }]);
    const openrouterCalls = fetchSpy.mock.calls.filter(c => String(c[0]).includes('openrouter.ai'));
    expect(openrouterCalls.length).toBe(2); // 1 models + 1 chat
  });

  it('all configured providers fail -> throws', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      return jsonResponse({}, false, 500);
    });
    await expect(extractOrderItems('quiero tomate', ['Tomate'])).rejects.toThrow();
  });

  it('a TRANSIENT failure (503) on Gemini falls through to Groq for this request but does NOT blacklist the model FOREVER - it is retried again once the provider-level cooldown expires', async () => {
    // Found live: evicting a model from modelDiscovery's cache on every kind
    // of failure meant one transient 503 on the preferred model blacklisted
    // it for up to an hour - that part is unchanged, still covered by
    // modelDiscovery's own isPermanentModelError tests. What DID change
    // (speed finding, confirmed live sep/2026: Gemini's free "flash" tier has
    // real, repeated multi-minute capacity outages several times a week) - a
    // request landing seconds after a transient failure no longer retries the
    // still-down provider first and eats its full latency again; it skips
    // straight to Groq for COOLDOWN_MS, then tries Gemini first again exactly
    // as before once that short window passes. Gemini's maxCandidates is 1,
    // so Groq is configured too here - a transient Gemini failure must fall
    // through to a WORKING provider, not a 2nd Gemini candidate (there isn't
    // one).
    (config as any).GEMINI_API_KEY = 'test-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    let flashCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) {
        flashCalls++;
        if (flashCalls === 1) return jsonResponse({}, false, 503); // transient, first call only
        return jsonResponse(geminiChatBody([{ product_name: 'segunda vez (gemini)', quantity_label: '' }]));
      }
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      return jsonResponse(chatBody([{ product_name: 'primera vez (groq)', quantity_label: '' }]));
    });

    const first = await extractOrderItems('quiero algo', ['Algo']);
    expect(first).toEqual([{ product_name: 'primera vez (groq)', quantity_label: '' }]);
    expect(flashCalls).toBe(1); // tried once, failed with 503, fell through to Groq

    // Still inside the cooldown window - Gemini must be SKIPPED this time,
    // straight to Groq, without even attempting gemini-2.5-flash again.
    const stillCooling = await extractOrderItems('quiero algo mientras enfría', ['Algo']);
    expect(stillCooling).toEqual([{ product_name: 'primera vez (groq)', quantity_label: '' }]);
    expect(flashCalls).toBe(1); // unchanged - Gemini was not called at all this time

    // Advance real time past the cooldown window - Gemini must be tried
    // FIRST again, not skipped - and this time it succeeds, so Groq is never
    // even reached.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 90_001);
    const afterCooldown = await extractOrderItems('quiero otra cosa', ['Algo']);
    expect(afterCooldown).toEqual([{ product_name: 'segunda vez (gemini)', quantity_label: '' }]);
    expect(flashCalls).toBe(2);
  });

  it('a NON-transient failure (400, e.g. malformed JSON) does NOT trigger the cooldown - the very next request still tries the same provider first', async () => {
    // A 400 says "this one generation was bad", not "the provider is down" -
    // must not cost the provider its priority spot for the next 90s the way
    // a real 5xx/timeout does.
    (config as any).GEMINI_API_KEY = 'test-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    let flashCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) {
        flashCalls++;
        if (flashCalls === 1) return jsonResponse({}, false, 400); // non-transient, first call only
        return jsonResponse(geminiChatBody([{ product_name: 'segunda vez (gemini)', quantity_label: '' }]));
      }
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      return jsonResponse(chatBody([{ product_name: 'primera vez (groq)', quantity_label: '' }]));
    });

    const first = await extractOrderItems('quiero algo', ['Algo']);
    expect(first).toEqual([{ product_name: 'primera vez (groq)', quantity_label: '' }]);
    expect(flashCalls).toBe(1);

    // No cooldown applied for a 400 - Gemini tried first again immediately.
    const second = await extractOrderItems('quiero otra cosa', ['Algo']);
    expect(second).toEqual([{ product_name: 'segunda vez (gemini)', quantity_label: '' }]);
    expect(flashCalls).toBe(2);
  });

  it('a provider returning JSON that fails the schema is treated as a failure, not a crash', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    (config as any).GROQ_API_KEY = 'groq-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) return jsonResponse(geminiChatBody('not-an-array'));
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse(groqModelsBody);
      return jsonResponse(chatBody([{ product_name: 'cebolla', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero cebolla', ['Cebolla']);
    expect(items).toEqual([{ product_name: 'cebolla', quantity_label: '' }]);
    const geminiChatCalls = fetchSpy.mock.calls.filter(c => String(c[0]).includes('generativelanguage.googleapis.com') && !String(c[0]).includes('/models?'));
    expect(geminiChatCalls.length).toBe(1); // gemini's one candidate, then falls to Groq
  });

  it('a provider wrapping its JSON in a markdown code fence still parses (confirmed live from a real free model)', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    const fenced = '```json\n' + JSON.stringify({ items: [{ product_name: 'pepino', quantity_label: '' }] }) + '\n```';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: fenced }] } }] });
    });
    const items = await extractOrderItems('quiero pepino', ['Pepino']);
    expect(items).toEqual([{ product_name: 'pepino', quantity_label: '' }]);
  });
});
