import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
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
// DetallePedidoModal). Abre un menú con 3 formas de enviar:
//   - Catálogo completo: NO arma una sola imagen gigante con las 3 categorías
//     (quedaba demasiado alta, la letra se veía minúscula en la vista previa
//     de WhatsApp) - manda una imagen POR categoría, en secuencia.
//   - Una categoría puntual: igual, una sola imagen.
//   - Un producto: sin imagen (confirmado con el usuario - no aporta nada sin
//     foto real) - manda un texto plano por POST /inbox/:ticketId/reply.
//
// El menú desplegable se renderiza en un portal a document.body con
// `position:fixed` calculado desde el botón (no `position:absolute` dentro
// del propio panel de chat) - a propósito: el panel de chat tiene su propio
// scroll/overflow, y un menú absoluto ahí adentro alteraba el alto
// "scrollable" de ese contenedor y hacía que la ventana de chat se corriera/
// scrolleara sola al abrirlo. Con position:fixed + portal, el menú flota
// encima de todo sin tocar el layout de nada más.
export function EnviarCatalogoMenu({ ticketId, products, disabled }: Props) {
  const orgName = useAuthStore(s => s.user?.orgName);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 6, left: r.left });
    };
    reposition();

    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    }
    // REPOSICIONA en vez de cerrar en scroll/resize (antes cerraba) - un clic
    // que abre el menú también mueve el foco al botón, y el navegador a veces
    // hace un auto-scroll para dejarlo visible; cerrar en CUALQUIER scroll
    // dejaba la puerta abierta a que ese (u otro) scroll incidental cerrara el
    // menú en el mismo gesto que lo abría. Mismo ajuste hecho en
    // config/ProductsSection.tsx's CategoryPicker.
    function onScrollOrResize() { reposition(); }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setMode('menu');
    setQuery('');
  }

  const categories = sortCategoryEntries(
    Array.from(new Set(products.map(p => p.category || 'Sin categoría'))).map(c => [c, null] as [string, null])
  ).map(([c]) => c);

  async function sendCategoryImage(categoryFilter: string | undefined, caption: string) {
    const canvas = generateCatalogCanvas(products, { categoryFilter, businessName: orgName ?? undefined });
    const data = canvasToBase64Png(canvas);
    await api.post(`/inbox/${ticketId}/send-image`, { data, mime_type: 'image/png', caption });
  }

  async function sendFullCatalog() {
    setSending(true);
    try {
      if (categories.length === 0) {
        toast('No hay productos para enviar', true);
        return;
      }
      // En secuencia (awaited una por una), no en paralelo - para que lleguen
      // al chat del cliente en el mismo orden en que se muestran acá (Frutas,
      // Verduras, Otros, ...), igual que el envío de 3 mensajes seguidos ya
      // usado para el link de formulario (NuevoPedidoModal).
      for (const cat of categories) {
        await sendCategoryImage(cat, cat);
      }
      toast('Catálogo enviado');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo enviar el catálogo', true);
    } finally {
      setSending(false);
      close();
    }
  }

  async function sendOneCategory(cat: string) {
    setSending(true);
    try {
      await sendCategoryImage(cat, cat);
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
      const unit = p.unit_type ?? 'kg';
      const text = p.in_stock === false
        ? `${p.name}: NO HAY`
        : `${p.name}: ${p.price_per_unit != null ? `$${Number(p.price_per_unit).toLocaleString('es-CO')}` : 'Consultar'}/${unit}`;
      await api.post(`/inbox/${ticketId}/reply`, { text });
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
    <>
      <button ref={btnRef} className="hdr-ic-btn" title="Enviar catálogo de productos a este cliente"
        onClick={() => setOpen(o => !o)} disabled={disabled || sending}>
        <ImageIcon size={13} /><span>Enviar<br />catálogo</span>
      </button>
      {open && coords && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: coords.top, left: coords.left, zIndex: 1000,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 6, width: 230, maxHeight: 320, overflowY: 'auto',
        }}>
          {mode === 'menu' ? (
            <>
              <button style={itemStyle} onClick={sendFullCatalog} disabled={sending}
                onMouseDown={e => e.preventDefault()}>
                Catálogo completo
              </button>
              {categories.map(cat => (
                <button key={cat} style={itemStyle} onClick={() => sendOneCategory(cat)} disabled={sending}
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
        </div>,
        document.body
      )}
    </>
  );
}
