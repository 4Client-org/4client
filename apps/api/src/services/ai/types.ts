import { z } from 'zod';

// Shared by every provider in this directory (groq.ts, cerebras.ts)
// so "Tomar lista" (routes/inbox.ts's /parse-messages) can swap/reorder/add
// providers in index.ts without touching the prompt or the validation logic.

export interface ExtractedItem {
  product_name: string;
  quantity_label: string;
}

export type Extractor = (text: string, catalogNames: string[]) => Promise<ExtractedItem[]>;

// Wrapped in an object (not a bare array) - some providers' JSON modes only
// guarantee "a valid JSON object", not "a valid JSON array" at the top level.
export const extractedItemsSchema = z.object({
  items: z.array(z.object({
    product_name: z.string().min(1).max(200),
    quantity_label: z.string().max(100).optional().default(''),
  })),
});

// Smaller/free models routinely ignore "no agregues texto fuera del JSON" and
// wrap their answer in a markdown code fence anyway (confirmed live: OpenRouter's
// inclusionai/ling-3.0-flash-fin does this often enough to matter) - JSON.parse
// chokes on the ``` before/after the actual object. Strips a leading ```json /
// ``` and a trailing ``` if present; a no-op on already-clean JSON.
export function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

// Spanish system prompt shared by every provider - same wording everywhere so
// swapping providers never silently changes extraction quality by accident.
// catalogNames is passed as a hint, not a hard constraint: matchProduct.ts
// does the actual catalog matching afterward, so the model is free to name a
// product slightly differently than the catalog (e.g. "papa" vs "Papa criolla").
export function buildExtractionPrompt(text: string, catalogNames: string[]): { system: string; user: string } {
  return {
    system:
      'Eres un asistente que extrae productos y cantidades de mensajes de WhatsApp de un ' +
      'cliente haciendo un pedido a una tienda de frutas y verduras. Responde SOLO con un ' +
      'objeto JSON de la forma {"items":[{"product_name":"...","quantity_label":"..."}]}. ' +
      '"product_name" es el nombre del producto tal como lo escribió el cliente (no lo ' +
      'traduzcas ni lo inventes). "quantity_label" es la cantidad/unidad tal como la escribió ' +
      '(ej. "2 kg", "1 libra", "3", "una malla") o cadena vacía si no menciona cantidad. Si un ' +
      'mensaje no describe ningún producto, no lo incluyas. No agregues texto fuera del JSON.',
    user:
      `Catálogo de referencia (puede que el cliente no use exactamente estos nombres):\n${catalogNames.join(', ')}\n\n` +
      `Mensajes del cliente:\n${text}`,
  };
}
