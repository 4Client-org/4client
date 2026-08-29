import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { extractOrderItems } from '../src/services/ai/index.js';

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

// Both providers are OpenAI-compatible chat completions - same response shape.
const groqStyleBody = (items: unknown) => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] });

describe('extractOrderItems (services/ai/index.ts provider fallback)', () => {
  beforeEach(() => {
    clearKeys();
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

  it('only OpenRouter configured -> only its URL is called', async () => {
    (config as any).OPENROUTER_API_KEY = 'test-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(groqStyleBody([{ product_name: 'papa', quantity_label: '1 kg' }])),
    );
    const items = await extractOrderItems('quiero papa', ['Papa']);
    expect(items).toEqual([{ product_name: 'papa', quantity_label: '1 kg' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][0] as string)).toContain('openrouter.ai');
  });

  it('Groq configured and fails -> falls through to OpenRouter automatically', async () => {
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('groq.com')) return jsonResponse({}, false, 500);
      return jsonResponse(groqStyleBody([{ product_name: 'tomate', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero tomate', ['Tomate']);
    expect(items).toEqual([{ product_name: 'tomate', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('all configured providers fail -> throws', async () => {
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, false, 500));
    await expect(extractOrderItems('quiero tomate', ['Tomate'])).rejects.toThrow();
  });

  it('a provider returning JSON that fails the schema is treated as a failure, not a crash', async () => {
    (config as any).GROQ_API_KEY = 'groq-key';
    (config as any).OPENROUTER_API_KEY = 'openrouter-key';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('groq.com')) return jsonResponse(groqStyleBody('not-an-array'));
      return jsonResponse(groqStyleBody([{ product_name: 'cebolla', quantity_label: '' }]));
    });
    const items = await extractOrderItems('quiero cebolla', ['Cebolla']);
    expect(items).toEqual([{ product_name: 'cebolla', quantity_label: '' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
