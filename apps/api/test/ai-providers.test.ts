import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { extractOrderItems } from '../src/services/ai/index.js';
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
const geminiModelsBody = {
  models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ],
};
const geminiChatBody = (items: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] });

// Groq and OpenRouter are both OpenAI-compatible - same {data:[...]} /models
// shape and {choices:[{message:{content}}]} chat shape.
const groqModelsBody = { data: [{ id: 'openai/gpt-oss-20b', active: true, input_modalities: ['text'], output_modalities: ['text'] }] };
const openrouterModelsBody = { data: [{ id: 'inclusionai/ling-3.0-flash-fin:free', pricing: { prompt: '0', completion: '0' } }] };
const chatBody = (items: unknown) => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] });

describe('extractOrderItems (services/ai/index.ts provider fallback)', () => {
  beforeEach(() => {
    clearKeys();
    clearDiscoveryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (config as any).GEMINI_API_KEY = ORIGINAL.gemini;
    (config as any).GROQ_API_KEY = ORIGINAL.groq;
    (config as any).OPENROUTER_API_KEY = ORIGINAL.openrouter;
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

  it('Gemini: first candidate fails -> tries the next discovered model automatically', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) return jsonResponse({}, false, 404);
      return jsonResponse(geminiChatBody([{ product_name: 'tomate', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero tomate', ['Tomate']);
    expect(items).toEqual([{ product_name: 'tomate', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 models + 2 chat attempts
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

  it('a TRANSIENT failure (503) falls through for this request but does NOT blacklist the model - the next request tries it again first', async () => {
    // Found live: evicting a model from the cache on every kind of failure
    // meant one transient 503 on the preferred model blacklisted it for up
    // to an hour, even though it had already recovered - every request in
    // that window fell straight to a since-retired fallback that 404s every
    // time. Only a permanent failure (400/404) should evict; a 503 should not.
    (config as any).GEMINI_API_KEY = 'test-key';
    let flashCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) {
        flashCalls++;
        if (flashCalls === 1) return jsonResponse({}, false, 503); // transient, first call only
        return jsonResponse(geminiChatBody([{ product_name: 'segunda vez', quantity_label: '' }]));
      }
      return jsonResponse(geminiChatBody([{ product_name: 'primera vez (fallback)', quantity_label: '' }]));
    });

    const first = await extractOrderItems('quiero algo', ['Algo']);
    expect(first).toEqual([{ product_name: 'primera vez (fallback)', quantity_label: '' }]);
    expect(flashCalls).toBe(1); // tried once, failed with 503, fell through

    // Second request (models list still cached, no clearDiscoveryCache() in
    // between) - gemini-2.5-flash must be tried FIRST again, not skipped.
    const second = await extractOrderItems('quiero otra cosa', ['Algo']);
    expect(second).toEqual([{ product_name: 'segunda vez', quantity_label: '' }]);
    expect(flashCalls).toBe(2);
  });

  it('a provider returning JSON that fails the schema is treated as a failure, not a crash', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      if (u.includes('gemini-2.5-flash:')) return jsonResponse(geminiChatBody('not-an-array'));
      return jsonResponse(geminiChatBody([{ product_name: 'cebolla', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero cebolla', ['Cebolla']);
    expect(items).toEqual([{ product_name: 'cebolla', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 models + 2 chat attempts
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
