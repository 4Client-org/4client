import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { normalizeSearch } from '../../lib/normalize';
import { sortCategoryEntries } from '../../lib/categoryOrder';
import { generateCatalogCanvas, canvasToBase64Png, type CatalogProduct } from '../../lib/catalogImage';

interface Props {
  ticketId: string;
  products: CatalogProduct[];
  disabled?: boolean;
}

type Mode = 'menu' | 'producto';

// Botón "Enviar catálogo" - vive entre "Bloquear Link" y "Tomar lista" en los
// mismos 3 modales que ya tienen ese par (TicketModal/NuevoPedidoModal/
// DetallePedidoModal). Abre un menú con 3 formas de enviar, en vez de mandar
// directo el catálogo completo cada vez (a pedido del usuario tras ver el
// primer plan - no siempre se necesitan las 3 categorías juntas, y a veces
// solo hace falta el precio de un producto puntual):
//   - Catálogo completo / por categoría -> genera la imagen (lib/catalogImage.ts)
//     y la manda por POST /inbox/:ticketId/send-image (ya existía, sin cambios).
//   - Un producto -> NO genera imagen (confirmado con el usuario: una imagen
//     de un solo producto no aporta nada sin foto real, y no es más rápido
//     generarla) - manda un texto plano por POST /inbox/:ticketId/reply (ya
//     existía también).
export function EnviarCatalogoMenu({ ticketId, products, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function close() {
    setOpen(false);
    setMode('menu');
    setQuery('');
  }

  const categories = sortCategoryEntries(
    Array.from(new Set(products.map(p => p.category || 'Sin categoría'))).map(c => [c, null] as [string, null])
  ).map(([c]) => c);

  async function sendImage(categoryFilter?: string) {
    setSending(true);
    try {
      const canvas = generateCatalogCanvas(products, { categoryFilter });
      const data = canvasToBase64Png(canvas);
      await api.post(`/inbox/${ticketId}/send-image`, {
        data,
        mime_type: 'image/png',
        caption: categoryFilter ? `Catálogo - ${categoryFilter}` : 'Catálogo de productos actualizado',
      });
      toast('Catálogo enviado');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo enviar el catálogo', true);
    } finally {
      setSending(false);
      close();
    }
  }

  async function sendProduct(p: CatalogProduct) {
    setSending(true);
    try {
      const price = p.price_per_unit != null ? `$${Number(p.price_per_unit).toLocaleString('es-CO')}` : 'Consultar';
      const unit = p.unit_type ?? 'kg';
      await api.post(`/inbox/${ticketId}/reply`, { text: `🛒 *${p.name}*: ${price}/${unit}` });
      toast('Precio enviado');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo enviar', true);
    } finally {
      setSending(false);
      close();
    }
  }

  const queryNorm = normalizeSearch(query.trim());
  const filteredProducts = queryNorm
    ? products.filter(p => normalizeSearch(p.name).includes(queryNorm)).slice(0, 8)
    : [];

  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    padding: '8px 10px', fontSize: 13, borderRadius: 6, cursor: 'pointer', color: 'var(--n)',
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button className="hdr-ic-btn" title="Enviar catálogo de productos a este cliente"
        onClick={() => setOpen(o => !o)} disabled={disabled || sending}>
        <ImageIcon size={13} /><span>Enviar<br />catálogo</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 250,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 6, width: 230, maxHeight: 320, overflowY: 'auto',
        }}>
          {mode === 'menu' ? (
            <>
              <button style={{ ...itemStyle, fontWeight: 700 }} onClick={() => sendImage()} disabled={sending}
                onMouseDown={e => e.preventDefault()}>
                📋 Catálogo completo
              </button>
              {categories.map(cat => (
                <button key={cat} style={itemStyle} onClick={() => sendImage(cat)} disabled={sending}
                  onMouseDown={e => e.preventDefault()}>
                  {cat}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--brd)', margin: '4px 0' }} />
              <button style={itemStyle} onClick={() => setMode('producto')} disabled={sending}
                onMouseDown={e => e.preventDefault()}>
                <Search size={12} style={{ marginRight: 6, verticalAlign: -1 }} />Un producto...
              </button>
            </>
          ) : (
            <div>
              <input
                className="fi"
                autoFocus
                placeholder="Buscar producto..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ marginBottom: 6, fontSize: 13 }}
              />
              {queryNorm === '' ? (
                <div style={{ fontSize: 12, color: 'var(--gt)', padding: '4px 6px' }}>Escribe para buscar</div>
              ) : filteredProducts.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--gt)', padding: '4px 6px' }}>Sin resultados</div>
              ) : (
                filteredProducts.map(p => (
                  <button key={p.id} style={itemStyle} onClick={() => sendProduct(p)} disabled={sending}
                    onMouseDown={e => e.preventDefault()}>
                    {p.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
