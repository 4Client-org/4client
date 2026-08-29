import { config } from '../../config.js';
import { buildExtractionPrompt, extractedItemsSchema, type ExtractedItem } from './types.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Gemini's own schema enforcement (responseSchema, not just responseMimeType)
// is the most reliable of the three providers - the model is constrained to
// this exact shape at generation time, not just asked nicely to produce it.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          product_name: { type: 'STRING' },
          quantity_label: { type: 'STRING' },
        },
        required: ['product_name'],
      },
    },
  },
  required: ['items'],
};

export async function extractWithGemini(text: string, catalogNames: string[]): Promise<ExtractedItem[]> {
  const { system, user } = buildExtractionPrompt(text, catalogNames);

  const res = await fetch(`${GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { candidates: [{ content: { parts: [{ text: string }] } }] };
  const raw = JSON.parse(data.candidates[0].content.parts[0].text);
  const parsed = extractedItemsSchema.parse(raw);
  return parsed.items;
}
