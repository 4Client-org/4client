import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, type ExtractedItem } from './types.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Small, fast model - plenty for extracting a handful of items from a short
// chat message, keeps this comfortably inside Groq's free-tier rate limit.
const GROQ_MODEL = 'llama-3.1-8b-instant';

export async function extractWithGroq(text: string, catalogNames: string[]): Promise<ExtractedItem[]> {
  const { system, user } = buildExtractionPrompt(text, catalogNames);

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
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
    throw new Error(`Groq API failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { choices: [{ message: { content: string } }] };
  const raw = JSON.parse(data.choices[0].message.content);
  const parsed = extractedItemsSchema.parse(raw);
  return parsed.items;
}
