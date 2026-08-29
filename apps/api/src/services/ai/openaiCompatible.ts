import { buildExtractionPrompt, extractedItemsSchema, stripJsonFence, type Extractor } from './types.js';

// Groq, Cerebras, OpenRouter (and most other free-tier LLM APIs) all speak the
// same OpenAI-compatible chat completions shape - one request builder + one
// response parser, each provider file just supplies its own URL/model/key/
// headers. Adding a 5th/6th free provider later is a ~10-line file, not a
// copy-pasted fetch call.
interface OpenAiCompatibleConfig {
  // Used only in error messages, so a failed call in the logs says which
  // provider actually failed (see services/ai/index.ts's fallback logging).
  label: string;
  url: string;
  model: string;
  // A function, not a plain value - config.<X>_API_KEY must be read at CALL
  // time, not when the module loads, so tests can set/delete it per-test (see
  // test/ai-providers.test.ts) and so a key added via `railway variables --set`
  // takes effect without restarting anything beyond the normal deploy.
  getApiKey: () => string | undefined;
  extraHeaders?: () => Record<string, string>;
  // Not every OpenAI-compatible provider's free model actually supports
  // structured outputs (confirmed the hard way - see openrouter.ts's comment)
  // - when a model 400s on `response_format`, this is set false and the
  // extraction relies purely on the prompt's own "responde SOLO con JSON"
  // instruction, still validated by the same zod schema afterward. Default true.
  useJsonMode?: boolean;
}

export function createOpenAiCompatibleExtractor(cfg: OpenAiCompatibleConfig): Extractor {
  return async (text, catalogNames) => {
    const { system, user } = buildExtractionPrompt(text, catalogNames);

    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.getApiKey()}`,
        'Content-Type': 'application/json',
        ...(cfg.extraHeaders?.() ?? {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(cfg.useJsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`${cfg.label} API failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { choices: [{ message: { content: string } }] };
    const raw = JSON.parse(stripJsonFence(data.choices[0].message.content));
    const parsed = extractedItemsSchema.parse(raw);
    return parsed.items;
  };
}
