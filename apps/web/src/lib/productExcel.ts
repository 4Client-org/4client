import * as XLSX from 'xlsx';

// v1 scope (decided explicitly): the Excel round-trip only ever touches
// price - Nombre/Categoría/Unidad are exported for reference so whoever edits
// the file can tell products apart, but they're read-only on re-upload; only
// the Precio column is ever sent back to the server. Uploading never creates
// a product - a row whose ID doesn't match an existing product in this org is
// silently skipped and counted in `skipped`, same as any other invalid row.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProductForExport {
  id: string;
  name: string;
  category?: string | null;
  unit_type?: string | null;
  price_per_unit?: number | string | null;
}

export function downloadProductsExcel(products: ProductForExport[]) {
  const rows = products.map(p => ({
    ID: p.id,
    Nombre: p.name,
    Categoría: p.category || '',
    Unidad: p.unit_type || 'kg',
    Precio: p.price_per_unit != null ? Number(p.price_per_unit) : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 38 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Precios');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Catalogo_precios_${fecha}.xlsx`);
}

export interface PriceUpdate { id: string; price_per_unit: number; }
export interface ParsedExcelResult { updates: PriceUpdate[]; skipped: number; }

// Blank/non-numeric Precio, an unrecognized/blank ID, or a duplicated ID all
// count as "skipped" - matches the existing convention (ProductsSection's own
// single-product form) that a blank price means "don't touch", never "set to
// zero" (an explicit 0 IS a valid price - agotado - so it's still accepted).
export async function parseProductsExcelFile(file: File): Promise<ParsedExcelResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { updates: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const seen = new Set<string>();
  const updates: PriceUpdate[] = [];
  let skipped = 0;
  for (const row of rows) {
    const id = String(row.ID ?? row.id ?? '').trim();
    const priceRaw = row.Precio ?? row.precio ?? row.PRECIO;
    const priceStr = String(priceRaw ?? '').trim();
    const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(priceStr);
    if (!id || !UUID_RE.test(id) || seen.has(id) || priceStr === '' || isNaN(price) || price < 0) {
      skipped++;
      continue;
    }
    seen.add(id);
    updates.push({ id, price_per_unit: price });
  }
  return { updates, skipped };
}
