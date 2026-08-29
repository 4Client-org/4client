import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, type ExtractedItem } from './types.js';

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODEL = 'llama3.1-8b';

// OpenAI-compatible chat completions, same shape as groq.ts (separate module
// only because the two providers have separate API keys/quotas - the request/
// response shape is close enough that a shared helper would save little).
export async function extractWithCerebras(text: string, catalogNames: string[]): Promise<ExtractedItem[]> {
  const { system, user } = buildExtractionPrompt(text, catalogNames);

  const res = await fetch(CEREBRAS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.CEREBRAS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
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
    throw new Error(`Cerebras API failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { choices: [{ message: { content: string } }] };
  const raw = JSON.parse(data.choices[0].message.content);
  const parsed = extractedItemsSchema.parse(raw);
  return parsed.items;
}
