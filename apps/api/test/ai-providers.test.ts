import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { extractOrderItems } from '../src/services/ai/index.js';
import { clearDiscoveryCache } from '../src/services/ai/modelDiscovery.js';

// config is a plain mutable object (see config.ts) - tests set/delete keys
// directly per case instead of needing separate env-var-injection infra.
// Cerebras is currently NOT in the active PROVIDERS chain (see index.ts's
// comment - every model on the free trial 402s on this account) - no tests
// for it here since setting CEREBRAS_API_KEY alone should have NO effect.
const ORIGINAL = {
  groq: config.GROQ_API_KEY,
  openrouter: config.OPENROUTER_API_KEY,
};

function clearKeys() {
  delete (config as any).GROQ_API_KEY;
  delete (config as any).OPENROUTER_API_KEY;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

// Both providers now discover their model list live (see modelDiscovery.ts) -
// each test's fetch mock must answer the provider's /models call as well as
// its /chat/completions call, keyed by URL.
const groqModelsBody = {
  data: [
    { id: 'openai/gpt-oss-20b', active: true, input_modalities: ['text'], output_modalities: ['text'] },
    { id: 'qwen/qwen3.6-27b', active: true, input_modalities: ['text'], output_modalities: ['text'] },
    { id: 'whisper-large-v3', active: true, input_modalities: ['audio'], output_modalities: ['transcription'] },
  ],
};
const openrouterModelsBody = {
  data: [
    { id: 'inclusionai/ling-3.0-flash-fin:free', pricing: { prompt: '0', completion: '0' } },
    { id: 'google/gemma-4-31b-it:free', pricing: { prompt: '0', completion: '0' } },
    { id: 'some/paid-model', pricing: { prompt: '0.001', completion: '0.002' } },
  ],
};
const chatBody = (items: unknown) => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] });

describe('extractOrderItems (services/ai/index.ts provider fallback)', () => {
  beforeEach(() => {
    clearKeys();
    clearDiscoveryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
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
    delete (config as any).CEREBRAS_API_KEY;
  });

  it('only OpenRouter configured -> discovers its free model list, calls the preferred one', async () => {
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(openrouterModelsBody);
      return jsonResponse(chatBody([{ product_name: 'papa', quantity_label: '1 kg' }]));
    });
    const items = await extractOrderItems('quiero papa', ['Papa']);
    expect(items).toEqual([{ product_name: 'papa', quantity_label: '1 kg' }]);
    // One /models call + one /chat/completions call for the preferred model.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const chatCall = fetchSpy.mock.calls.find(c => !String(c[0]).includes('/models'))!;
    const sentBody = JSON.parse((chatCall[1] as RequestInit).body as string);
    expect(sentBody.model).toBe('inclusionai/ling-3.0-flash-fin:free');
  });

  it('OpenRouter: preferred model fails -> tries the next free candidate automatically', async () => {
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(openrouterModelsBody);
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.model === 'inclusionai/ling-3.0-flash-fin:free') return jsonResponse({}, false, 404);
      return jsonResponse(chatBody([{ product_name: 'tomate', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero tomate', ['Tomate']);
    expect(items).toEqual([{ product_name: 'tomate', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 models + 2 chat attempts
  });

  it('Groq configured and its only candidate fails -> falls through to OpenRouter (the next provider)', async () => {
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('groq.com/openai/v1/models')) return jsonResponse({ data: [groqModelsBody.data[0]] });
      if (u.includes('groq.com')) return jsonResponse({}, false, 500);
      if (u.includes('openrouter.ai/api/v1/models')) return jsonResponse(openrouterModelsBody);
      return jsonResponse(chatBody([{ product_name: 'tomate', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero tomate', ['Tomate']);
    expect(items).toEqual([{ product_name: 'tomate', quantity_label: '' }]);
  });

  it('all configured providers fail -> throws', async () => {
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(u.includes('groq') ? groqModelsBody : openrouterModelsBody);
      return jsonResponse({}, false, 500);
    });
    await expect(extractOrderItems('quiero tomate', ['Tomate'])).rejects.toThrow();
  });

  it('a provider returning JSON that fails the schema is treated as a failure, not a crash', async () => {
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(openrouterModelsBody);
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.model === 'inclusionai/ling-3.0-flash-fin:free') return jsonResponse(chatBody('not-an-array'));
      return jsonResponse(chatBody([{ product_name: 'cebolla', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero cebolla', ['Cebolla']);
    expect(items).toEqual([{ product_name: 'cebolla', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 models + 2 chat attempts
  });

  it('a provider wrapping its JSON in a markdown code fence still parses (confirmed live from a real free model)', async () => {
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fenced = '```json\n' + JSON.stringify({ items: [{ product_name: 'pepino', quantity_label: '' }] }) + '\n```';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse(openrouterModelsBody);
      return jsonResponse({ choices: [{ message: { content: fenced } }] });
    });
    const items = await extractOrderItems('quiero pepino', ['Pepino']);
    expect(items).toEqual([{ product_name: 'pepino', quantity_label: '' }]);
  });

  it('OpenRouter model list excludes non-free and denylisted-pattern models', async () => {
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/models')) return jsonResponse({
        data: [
          { id: 'some/paid-model:free-ish', pricing: { prompt: '0.001', completion: '0' } }, // not actually $0
          { id: 'some/thing-code:free', pricing: { prompt: '0', completion: '0' } }, // denylisted pattern
          { id: 'inclusionai/ling-3.0-flash-fin:free', pricing: { prompt: '0', completion: '0' } },
        ],
      });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('inclusionai/ling-3.0-flash-fin:free');
      return jsonResponse(chatBody([{ product_name: 'papa', quantity_label: '' }]));
    });
    await extractOrderItems('quiero papa', ['Papa']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
