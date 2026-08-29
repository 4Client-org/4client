import type { TomarListaItem } from '../hooks/useTomarLista';

// Item shape as kept in NuevoPedidoModal/DetallePedidoModal's own `items` draft
// state (price as a string, same as ProductSearch's own Item type) - kept
// loose/untyped like the rest of that state (see those files' own `useState<any[]>`).
interface DraftItem {
  product_name: string;
  quantity_label: string;
  price: string;
  added_by_client?: boolean;
  ai_unmatched?: boolean;
}

// Appends AI-extracted items to the draft list, skipping any whose
// product_name already exists exactly (same dedupe-by-product_name convention
// DetallePedidoModal's own socket `order:updated` handler already uses).
export function mergeExtractedItems(existing: DraftItem[], extracted: TomarListaItem[]): DraftItem[] {
  const known = new Set(existing.map(i => i.product_name));
  const toAdd = extracted
    .filter(i => !known.has(i.product_name))
    .map((i): DraftItem => ({
      product_name: i.product_name,
      quantity_label: i.quantity_label,
      price: String(i.price),
      added_by_client: i.added_by_client,
      ai_unmatched: i.ai_unmatched,
    }));
  return [...existing, ...toAdd];
}
