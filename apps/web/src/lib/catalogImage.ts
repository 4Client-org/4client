import { sortCategoryEntries } from './categoryOrder';

// Catálogo de WhatsApp (func. 3) - se dibuja por código en un <canvas> nativo
// del navegador en vez de usar una foto real por producto (decisión explícita
// del usuario: no quiere buscar/subir una foto por cada uno). Un ícono fijo
// por categoría hace las veces de "imagen" - esto es lo que permite que el
// catálogo siempre refleje el precio/unidad actual de la BD en el momento de
// generarlo, sin ningún mantenimiento de fotos.
export interface CatalogProduct {
  id: string;
  name: string;
  category?: string | null;
  price_per_unit?: number | string | null;
  unit_type?: string | null;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Frutas: '🍎',
  Verduras: '🥬',
  Otros: '📦',
};
function emojiFor(cat: string): string {
  return CATEGORY_EMOJI[cat] ?? '🛒';
}

const WIDTH = 800;
const PADDING = 32;
const HEADER_H = 108;
const CAT_BAND_H = 44;
const ROW_H = 42;
const COLS = 2; // dos columnas por categoría - mantiene la imagen razonablemente
                // compacta incluso con catálogos de 50+ productos

// `categoryFilter` deja generar el catálogo completo o solo una categoría (ej.
// "Frutas") - ver EnviarCatalogoMenu.tsx, que ofrece ambas opciones.
export function generateCatalogCanvas(products: CatalogProduct[], opts?: { categoryFilter?: string; businessName?: string }): HTMLCanvasElement {
  const filtered = opts?.categoryFilter
    ? products.filter(p => (p.category || 'Sin categoría') === opts.categoryFilter)
    : products;

  const grouped = filtered.reduce<Record<string, CatalogProduct[]>>((acc, p) => {
    const cat = p.category || 'Sin categoría';
    (acc[cat] ??= []).push(p);
    return acc;
  }, {});
  const groups = sortCategoryEntries(Object.entries(grouped));

  let height = HEADER_H + PADDING;
  for (const [, prods] of groups) {
    const rows = Math.ceil(prods.length / COLS);
    height += CAT_BAND_H + rows * ROW_H + 16;
  }
  if (groups.length === 0) height += 60;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = Math.max(height, HEADER_H + 100);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Encabezado
  ctx.fillStyle = '#166534';
  ctx.fillRect(0, 0, WIDTH, HEADER_H);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText(opts?.businessName ?? 'Catálogo de productos', PADDING, 50);
  ctx.font = '400 15px system-ui, sans-serif';
  const fecha = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(`${opts?.categoryFilter ? opts.categoryFilter + ' - ' : ''}Precios actualizados al ${fecha}`, PADDING, 80);

  if (groups.length === 0) {
    ctx.fillStyle = '#6B7280';
    ctx.font = '400 15px system-ui, sans-serif';
    ctx.fillText('Sin productos para mostrar.', PADDING, HEADER_H + 40);
    return canvas;
  }

  let y = HEADER_H + 16;
  const colWidth = (WIDTH - PADDING * 2) / COLS;
  for (const [cat, prods] of groups) {
    ctx.fillStyle = '#DCFCE7';
    ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, CAT_BAND_H);
    ctx.fillStyle = '#111827';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText(`${emojiFor(cat)} ${cat}`, PADDING + 12, y + 29);
    y += CAT_BAND_H + 10;

    prods.forEach((p, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const rx = PADDING + col * colWidth;
      const ry = y + row * ROW_H;
      const price = p.price_per_unit != null ? `$${Number(p.price_per_unit).toLocaleString('es-CO')}` : 'Consultar';
      const unit = p.unit_type ?? 'kg';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText(p.name, rx, ry + 17);
      ctx.font = '400 13px system-ui, sans-serif';
      ctx.fillStyle = '#166534';
      ctx.fillText(`${price}/${unit}`, rx, ry + 34);
    });
    const rows = Math.ceil(prods.length / COLS);
    y += rows * ROW_H + 16;
  }

  return canvas;
}

// `toDataURL` prefixes with "data:image/png;base64," - el backend
// (routes/inbox.ts's POST /:ticketId/send-image) solo quiere el base64 puro.
export function canvasToBase64Png(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}
