// Shared category display order, used by both the admin product table
// (config/ProductsSection.tsx) and the WhatsApp catalog image (lib/catalogImage.ts) -
// Frutas/Verduras first (the two biggest, most-asked-about groups), everything else
// (including "Otros" and any ad-hoc category an admin types in) alphabetically after.
// `Product.category` itself is a free-text column (schema.prisma) - this is purely a
// display convenience, never an enum enforced anywhere. Mirrors the equivalent list
// on the backend (apps/api/src/lib/categoryOrder.ts) - kept as two copies rather than
// a shared package because packages/shared today only carries types, no runtime code.
export const CATEGORY_PRIORITY = ['Frutas', 'Verduras', 'Otros'];

export function categoryRank(cat: string): number {
  const idx = CATEGORY_PRIORITY.indexOf(cat);
  return idx === -1 ? CATEGORY_PRIORITY.length : idx;
}

export function sortCategoryEntries<T>(entries: [string, T][]): [string, T][] {
  return entries.sort(([a], [b]) => {
    const ra = categoryRank(a), rb = categoryRank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}
