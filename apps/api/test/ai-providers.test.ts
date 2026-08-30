import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { extractOrderItems } from '../src/services/ai/index.js';
import { clearDiscoveryCache } from '../src/services/ai/modelDiscovery.js';

// config is a plain mutable object (see config.ts) - tests set/delete keys
// directly per case instead of needing separate env-var-injection infra.
// Gemini is the only active provider right now (services/ai/index.ts has
// Groq/Cerebras/OpenRouter commented out for this dev trial) - tests for
// those three now only need to confirm setting their key ALONE has no
// effect, not full fallback-chain behavior (that's exercised for Gemini
// below instead, same shape of coverage, just against whichever provider is
// actually wired in).
const ORIGINAL = { gemini: config.GEMINI_API_KEY };

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
// different from the OpenAI-style {choices:[...]} used elsewhere.
const geminiModelsBody = {
  models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ],
};
const geminiChatBody = (items: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] });

describe('extractOrderItems (services/ai/index.ts provider fallback)', () => {
  beforeEach(() => {
    clearKeys();
    clearDiscoveryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (config as any).GEMINI_API_KEY = ORIGINAL.gemini;
  });

  it('no provider configured -> throws immediately without calling fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    await expect(extractOrderItems('quiero papa', ['Papa'])).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setting GROQ_API_KEY/CEREBRAS_API_KEY/OPENROUTER_API_KEY alone has no effect (not in the active chain)', async () => {
    (config as any).GROQ_API_KEY = 'test-key';
    (config as any).CEREBRAS_API_KEY = 'test-key';
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch');
    await expect(extractOrderItems('quiero papa', ['Papa'])).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Gemini configured -> discovers its model list, calls a generateContent-capable candidate', async () => {
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
    // The embedding-only model must never be picked - it doesn't support generateContent.
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

  it('all configured providers fail -> throws', async () => {
    (config as any).GEMINI_API_KEY = 'test-key';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return jsonResponse(geminiModelsBody);
      return jsonResponse({}, false, 500);
    });
    await expect(extractOrderItems('quiero tomate', ['Tomate'])).rejects.toThrow();
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
