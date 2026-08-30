import type { TomarListaItem } from '../hooks/useTomarLista';
import { normalizeSearch } from './normalize';

// Item shape as kept in NuevoPedidoModal/DetallePedidoModal's own `items` draft
// state (price as a string, same as ProductSearch's own Item type) - kept
// loose/untyped like the rest of that state (see those files' own `useState<any[]>`).
interface DraftItem {
  // Client-only row identity (never sent to the backend - orders.ts's item
  // schema doesn't have this field, and every save payload explicitly lists
  // only product_name/quantity_label/price/etc., so it's dropped by
  // construction). ProductSearch.tsx keys/targets rows by this, NOT
  // product_name - two rows CAN legitimately share the same product_name
  // (this is exactly what the dedup above is trying to prevent, but a
  // manual add or a since-fixed typo can still produce one), and product_name
  // is also about to become directly editable for a flagged row, which would
  // make using it as an identity outright break (renaming a row would change
  // its own "key" mid-edit).
  _uid: string;
  product_name: string;
  quantity_label: string;
  price: string;
  added_by_client?: boolean;
  ai_unmatched?: boolean;
}

export interface MergeResult {
  items: DraftItem[];
  addedCount: number;
  skippedCount: number;
}

// Appends AI-extracted items to the draft list, skipping any that already
// match an existing item by product_name - compared with normalizeSearch
// (accent/case-insensitive, same as every search box in the app), NOT a raw
// exact string match: a pre-existing line could have been typed by hand or
// saved before this feature existed, with different casing than the
// catalog's own canonical name, and a raw compare would miss that and
// duplicate it.
//
// ALSO dedupes WITHIN the extracted batch itself, not just against `existing`
// - the `seen` set is updated as each item is accepted (not just seeded once
// from `existing` and left alone), because the AI can return the same
// product more than once when the customer mentioned it in more than one
// selected message (e.g. "quiero papa" ... later "y otra papa"). Backend
// (routes/inbox.ts) does its own pass of this same dedup before ever
// returning `items` - this is a second, independent check against whatever
// is ALREADY in the draft, which the backend has no way to know about.
//
// Deliberately keeps only the FIRST occurrence's quantity_label rather than
// summing quantities across duplicate mentions - matches the explicit "si ya
// está no lo agregues, si falta sí" behavior this was built for. A customer
// asking for more of something already in the draft needs staff to bump the
// quantity by hand; this only prevents a second identical line.
export function mergeExtractedItems(existing: DraftItem[], extracted: TomarListaItem[]): MergeResult {
  const seen = new Set(existing.map(i => normalizeSearch(i.product_name)));
  const toAdd: DraftItem[] = [];
  let skippedCount = 0;
  for (const i of extracted) {
    const key = normalizeSearch(i.product_name);
    if (seen.has(key)) { skippedCount++; continue; }
    seen.add(key);
    toAdd.push({
      _uid: crypto.randomUUID(),
      product_name: i.product_name,
      quantity_label: i.quantity_label,
      price: String(i.price),
      added_by_client: i.added_by_client,
      ai_unmatched: i.ai_unmatched,
    });
  }
  return { items: [...existing, ...toAdd], addedCount: toAdd.length, skippedCount };
}

// Shared wording so every caller (NuevoPedidoModal/DetallePedidoModal, both
// the direct-merge and the TomarListaResultModal-confirm paths) reports a
// skip the same way, instead of always saying "listo" even when nothing
// actually got added - staff should be able to tell a real no-op apart from
// a successful merge, especially when re-running Montar lista over
// already-processed messages by mistake.
export function mergeResultToast(result: MergeResult): string {
  if (result.addedCount === 0) {
    return result.skippedCount === 1
      ? 'Ese producto ya estaba en el pedido - no se agregó nada nuevo'
      : 'Esos productos ya estaban en el pedido - no se agregó nada nuevo';
  }
  if (result.skippedCount === 0) {
    return 'Lista montada exitosamente';
  }
  return `Lista montada - ${result.addedCount} producto${result.addedCount === 1 ? '' : 's'} nuevo${result.addedCount === 1 ? '' : 's'} (${result.skippedCount} ya estaba${result.skippedCount === 1 ? '' : 'n'} en el pedido)`;
}
