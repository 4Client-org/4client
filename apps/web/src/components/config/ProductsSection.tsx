import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronRight, Search, Download, Upload } from 'lucide-react';
import { sortCategoryEntries } from '../../lib/categoryOrder';
import { downloadProductsExcel, parseProductsExcelFile } from '../../lib/productExcel';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmDialog } from './ConfirmDialog';

// ─── Products ────────────────────────────────────────────────────────────────

// Column widths shared by the header row and every product row (view AND edit
// mode) so cells line up regardless of which rows are currently mid-edit.
const GRID_COLS = '1fr 170px 120px 110px 70px 100px';

interface ProductForm {
  name: string;
  category: string;
  newCategory: string;
  useNewCategory: boolean;
  price_per_unit: string;
  unit_type: string;
  in_stock: boolean;
}

const EMPTY_FORM = (existingCategories: string[]): ProductForm => ({
  name: '',
  category: existingCategories[0] ?? '',
  newCategory: '',
  useNewCategory: existingCategories.length === 0,
  price_per_unit: '',
  unit_type: 'kg',
  in_stock: true,
});

// Interruptor de Stock - a diferencia de Nombre/Categoría/Precio/Unidad, este
// NO se acumula en el borrador de la fila para esperar a un Guardar; se manda
// solo cuando el producto ya existe (ver toggleStock más abajo), consistente
// con lo que es un interruptor: se voltea y queda, no se "prepara" para
// guardar después. Para la fila nueva (sin id todavía) sí viaja en el
// borrador normal, porque ahí no hay nada que instantáneamente actualizar.
function StockToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={value ? 'Hay stock - clic para marcar agotado' : 'Sin stock - clic para reactivar'}
      onClick={() => onChange(!value)}
      disabled={disabled}
      style={{
        position: 'relative', width: 38, height: 21, borderRadius: 11, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: value ? 'var(--v)' : 'var(--brd)', transition: 'background .15s', padding: 0, flexShrink: 0,
      }}>
      <span style={{
        position: 'absolute', top: 2, left: value ? 19 : 2, width: 17, height: 17, borderRadius: '50%',
        background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

// Reemplaza el <select> nativo de categoría - un `<select>` normal debía
// bastar, pero un intento anterior (identidad de componente inestable, ya
// corregido) no eliminó el problema reportado ("le doy clic y se cierra
// solo") y no hay forma de reproducir/depurar un popup NATIVO del navegador
// desde acá. Un desplegable propio, hecho en React de punta a punta (mismo
// patrón de portal a document.body + position:fixed que EnviarCatalogoMenu.tsx),
// saca el control nativo de la ecuación por completo - cero dependencia del
// comportamiento del navegador/SO para abrir/cerrar el popup.
function CategoryPicker({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    reposition();
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    // REPOSICIONA en vez de cerrar en scroll/resize - antes cerraba
    // (`setOpen(false)`), lo que resultó demasiado agresivo: un clic que abre
    // el menú también mueve el foco al botón, y el navegador a veces hace un
    // auto-scroll para dejarlo visible; ese scroll incidental cerraba el menú
    // en el mismo gesto que lo abría. Un requestAnimationFrame de margen
    // arregló ESE caso puntual, pero seguir cerrando en cualquier scroll deja
    // la puerta abierta a que cualquier OTRA causa de scroll/resize (barra de
    // notificaciones del navegador, otra extensión, lo que sea) reproduzca lo
    // mismo. Reposicionar es estrictamente más robusto: el menú simplemente
    // seguía a su botón, nunca desaparece por una causa que no sea elegir una
    // opción o hacer clic realmente afuera.
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

  return (
    <>
      <button type="button" ref={btnRef} className="fi" onClick={() => setOpen(o => !o)}
        style={{ padding: '6px 8px', fontSize: 12, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, cursor: 'pointer', background: 'var(--b)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'inherit' : 'var(--gt)' }}>
          {value || placeholder || 'Sin categoría'}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0 }} />
      </button>
      {open && coords && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: coords.top, left: coords.left, minWidth: coords.width, zIndex: 1000,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 4, maxHeight: 240, overflowY: 'auto',
        }}>
          {options.length === 0 && <div style={{ fontSize: 12, color: 'var(--gt)', padding: '6px 8px' }}>Sin categorías todavía</div>}
          {options.map(opt => (
            <button key={opt} type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              onMouseDown={e => e.preventDefault()}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: opt === value ? 'var(--vc)' : 'none',
                border: 'none', padding: '7px 8px', fontSize: 13, borderRadius: 6, cursor: 'pointer', color: 'var(--n)',
              }}>
              {opt}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export default function ProductsSection() {
  const qc = useQueryClient();
  // Only one row can be mid-edit at a time (editing an existing product OR
  // filling in the blank "new product" row) - `editingId` is a real product id,
  // or the sentinel '__new__' for the blank row, or null when nothing is being
  // edited. `draft` holds every field's pending value for that one row - ALL 4
  // fields become inputs at once when a row enters edit mode (not one field at
  // a time), so a category change and a price change can both be pending
  // together and land in the same single Guardar/PATCH, per the redesign's
  // whole point of a per-row batch save (same idea as UsersSection.tsx's
  // editForm, applied per table row here instead of one shared panel).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductForm | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: any[] }>('/products').then((r) => r.data),
    staleTime: 0,
  });

  // Derive unique categories from existing products
  const existingCategories: string[] = Array.from(
    new Set((products as any[]).map((p: any) => p.category).filter(Boolean))
  ).sort() as string[];

  const save = useMutation({
    mutationFn: (body: any) =>
      editingId && editingId !== '__new__'
        ? api.patch(`/products/${editingId}`, body)
        : api.post('/products', body),
    onSuccess: () => {
      // No special-case code needed to "move" a product whose category just
      // changed into its new group - `grouped` below is recomputed from
      // `products` on every render, so a fresh category value places the row
      // under the right header on its own the moment this refetch lands.
      qc.invalidateQueries({ queryKey: ['products'] });
      setEditingId(null);
      setDraft(null);
      toast(editingId && editingId !== '__new__' ? 'Producto actualizado' : 'Producto creado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const toggleStock = useMutation({
    mutationFn: ({ id, in_stock }: { id: string; in_stock: boolean }) => api.patch(`/products/${id}`, { in_stock }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e: any) => toast(e.message, true),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setConfirmDelete(null);
      toast('Producto desactivado');
    },
    onError: (e: any) => { setConfirmDelete(null); toast(e.message, true); },
  });

  // Excel round-trip (func. 2) - descargar usa los `products` ya en caché, sin
  // fetch nuevo; subir parsea el archivo en el navegador (lib/productExcel.ts,
  // sin librería nueva en el backend) y solo envía {id, price_per_unit} al
  // endpoint nuevo - ver PATCH /products/bulk-price.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingExcel, setUploadingExcel] = useState(false);

  const bulkPrice = useMutation({
    mutationFn: (updates: { id: string; price_per_unit: number }[]) =>
      api.patch<{ data: { updated: number; notFound: string[] } }>('/products/bulk-price', { updates }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      const { updated, notFound } = res.data;
      toast(
        notFound.length > 0
          ? `${updated} precio${updated === 1 ? '' : 's'} actualizado${updated === 1 ? '' : 's'} - ${notFound.length} ID no encontrado${notFound.length === 1 ? '' : 's'}`
          : `${updated} precio${updated === 1 ? '' : 's'} actualizado${updated === 1 ? '' : 's'}`
      );
    },
    onError: (e: any) => toast(e.message, true),
    onSettled: () => setUploadingExcel(false),
  });

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same filename later
    if (!file) return;
    setUploadingExcel(true);
    try {
      const { updates, skipped } = await parseProductsExcelFile(file);
      if (updates.length === 0) {
        setUploadingExcel(false);
        return toast('Ningún precio válido para actualizar en ese archivo', true);
      }
      if (skipped > 0) toast(`${skipped} fila${skipped === 1 ? '' : 's'} del Excel se ignoraron (ID o precio inválido)`, true);
      bulkPrice.mutate(updates);
    } catch {
      setUploadingExcel(false);
      toast('No se pudo leer ese archivo - ¿es un .xlsx válido?', true);
    }
  }

  function openCreate() {
    setEditingId('__new__');
    setDraft(EMPTY_FORM(existingCategories));
  }

  function openEdit(p: any) {
    setEditingId(p.id);
    const catExists = existingCategories.includes(p.category ?? '');
    setDraft({
      name: p.name,
      category: catExists ? (p.category ?? '') : '',
      newCategory: catExists ? '' : (p.category ?? ''),
      useNewCategory: !catExists && !!p.category,
      price_per_unit: p.price_per_unit != null ? String(p.price_per_unit) : '',
      unit_type: p.unit_type ?? 'kg',
      in_stock: p.in_stock ?? true,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function resolvedCategory(f: ProductForm): string {
    return f.useNewCategory ? f.newCategory.trim() : f.category;
  }

  function handleSubmit() {
    if (!draft?.name.trim()) return toast('El nombre es obligatorio', true);
    const category = resolvedCategory(draft);
    // Blank input = "don't touch the price" (dropped from the payload entirely, so a
    // PATCH leaves the stored price as-is). An explicit "0" IS a valid price - it's how
    // a product gets marked agotado - so it must be sent through, not treated the same
    // as blank/invalid input like a plain `price > 0` check used to.
    const priceRaw = draft.price_per_unit.trim();
    const price = parseFloat(priceRaw);
    save.mutate({
      name: draft.name.trim(),
      category: category || undefined,
      price_per_unit: priceRaw === '' ? undefined : (!isNaN(price) && price >= 0 ? price : undefined),
      unit_type: draft.unit_type.trim() || undefined,
      // Solo se manda al CREAR - en edición el interruptor de Stock ya se
      // guardó al instante (toggleStock, arriba) apenas se tocó. El borrador
      // de esta fila puede llevar un `in_stock` desactualizado si el admin le
      // dio clic al interruptor y LUEGO cambió otro campo antes de Guardar -
      // reenviarlo acá revertiría ese cambio ya guardado por accidente.
      ...(editingId === '__new__' ? { in_stock: draft.in_stock } : {}),
    });
  }

  function toggleCat(cat: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  // Group by category
  const grouped = (products as any[]).reduce((acc: Record<string, any[]>, p: any) => {
    const cat = p.category || 'Sin categoría';
    acc[cat] = [...(acc[cat] ?? []), p];
    return acc;
  }, {});

  // While searching, skip the collapsible-by-category view entirely - a flat, matched
  // list is what actually saves the scrolling/expanding this was asked to avoid.
  const searchLower = search.trim().toLowerCase();
  const filteredFlat = searchLower
    ? (products as any[]).filter(p =>
        p.name.toLowerCase().includes(searchLower) || (p.category ?? '').toLowerCase().includes(searchLower))
    : [];

  // Category picker used by an editing row - same "existing category OR type
  // a new one" toggle the old shared form used, just embedded in one grid cell.
  // Uses CategoryPicker (custom dropdown, see above) instead of a native
  // `<select>` - a native select here kept closing itself immediately on
  // open ("le doy clic y se cierra solo"). One real cause was found and fixed
  // (this cell used to be a component defined inline inside ProductsSection's
  // own render body and invoked as JSX, `<CategoryCell />` - that gave it a
  // fresh component identity every render, so React remounted the `<select>`'s
  // real DOM node on every re-render, including the one triggered the instant
  // its native popup opened) but the report persisted after that fix, so
  // rather than keep chasing a browser-native popup's behavior blind,
  // CategoryPicker takes the native control out of the equation entirely -
  // it's a plain React-rendered dropdown (portal + position:fixed, same
  // pattern as chat/EnviarCatalogoMenu.tsx), so there is no OS/browser-level
  // popup left to close itself.
  //
  // Called as a plain function (`{renderCategoryCell()}`), NOT as a JSX
  // component (`<CategoryCell />`) - keeps this cell itself from ever having
  // that same inline-component-identity problem again.
  function renderCategoryCell() {
    if (!draft) return null;
    if (draft.useNewCategory) {
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="fi" style={{ padding: '6px 8px', fontSize: 12 }} value={draft.newCategory}
            onChange={e => setDraft(d => d && ({ ...d, newCategory: e.target.value }))}
            placeholder="Nueva categoría" autoFocus />
          {existingCategories.length > 0 && (
            <button type="button" className="dc-btn" title="Elegir existente"
              onClick={() => setDraft(d => d && ({ ...d, useNewCategory: false, newCategory: '' }))}>
              <X size={12} />
            </button>
          )}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <CategoryPicker value={draft.category} options={existingCategories}
          onChange={c => setDraft(d => d && ({ ...d, category: c }))} />
        <button type="button" className="dc-btn" title="Nueva categoría"
          onClick={() => setDraft(d => d && ({ ...d, useNewCategory: true, newCategory: '' }))}>
          <Plus size={12} />
        </button>
      </div>
    );
  }

  // One row - view mode by default, becomes the same row with 4 inputs in place
  // of the 4 value cells when it's the row currently in `editingId`. Clicking
  // any value cell OR the pencil both call `openEdit` - same effect either way,
  // matching the click-value-or-pencil pattern already established in
  // orders/ProductSearch.tsx's factbox rows.
  function renderProductRow(p: any) {
    const isEditing = editingId === p.id;
    if (isEditing && draft) {
      return (
        <div key={p.id} style={{ display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center', background: 'var(--vc)', padding: '8px 14px', gap: 10, borderTop: '1px solid var(--brd)' }}>
          <input className="fi" style={{ padding: '6px 8px', fontSize: 13, fontWeight: 600 }} value={draft.name}
            onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} autoFocus />
          {renderCategoryCell()}
          <input className="fi" type="number" min="0" style={{ padding: '6px 8px', fontSize: 12 }} value={draft.price_per_unit}
            onChange={e => setDraft(d => d && ({ ...d, price_per_unit: e.target.value }))} placeholder="Precio" />
          <select className="fi" style={{ padding: '6px 8px', fontSize: 12 }} value={draft.unit_type}
            onChange={e => setDraft(d => d && ({ ...d, unit_type: e.target.value }))}>
            <option value="kg">kg</option>
            <option value="unidad">Unidad</option>
            <option value="libra">Libra</option>
            <option value="bulto">Bulto</option>
            <option value="caja">Caja</option>
            <option value="canasta">Canasta</option>
            <option value="manojo">Manojo</option>
          </select>
          <StockToggle value={p.in_stock ?? true} onChange={v => toggleStock.mutate({ id: p.id, in_stock: v })} disabled={toggleStock.isPending} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dc-btn" title="Guardar cambios" onClick={handleSubmit} disabled={save.isPending}
              style={{ borderColor: 'var(--v)', color: 'var(--v)' }}>
              <Check size={13} />
            </button>
            <button className="dc-btn" title="Cancelar" onClick={cancelEdit}
              style={{ borderColor: 'var(--r)', color: 'var(--r)' }}>
              <X size={13} />
            </button>
          </div>
        </div>
      );
    }
    return (
      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center', background: 'var(--b)', padding: '10px 14px', gap: 10, borderTop: '1px solid var(--brd)' }}>
        <span onClick={() => openEdit(p)} style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} title="Clic para editar">
          {p.name}
        </span>
        <span onClick={() => openEdit(p)} style={{ fontSize: 12, color: 'var(--gt)', fontWeight: 600, cursor: 'pointer' }} title="Clic para editar">
          {p.category || 'Sin categoría'}
        </span>
        <span onClick={() => openEdit(p)} style={{ fontSize: 12, cursor: 'pointer' }} title="Clic para editar">
          {p.price_per_unit != null ? (
            <span style={{ color: 'var(--vd)', fontWeight: 700, background: 'var(--vc)', padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap' }}>
              ${Number(p.price_per_unit).toLocaleString('es-CO')}
            </span>
          ) : '-'}
        </span>
        <span onClick={() => openEdit(p)} style={{ fontSize: 12, color: 'var(--gt)', cursor: 'pointer' }} title="Clic para editar">
          {p.unit_type ?? 'kg'}
        </span>
        <StockToggle value={p.in_stock ?? true} onChange={v => toggleStock.mutate({ id: p.id, in_stock: v })} disabled={toggleStock.isPending} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="dc-btn" title="Editar" onClick={() => openEdit(p)}>
            <Pencil size={13} />
          </button>
          <button className="dc-btn" title="Desactivar"
            onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
            style={{ borderColor: 'var(--r)', color: 'var(--r)' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  }

  function renderNewRow() {
    if (editingId !== '__new__' || !draft) return null;
    return (
      <div style={{ border: '1.5px solid var(--v)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center', background: 'var(--vc)', padding: '8px 14px', gap: 10 }}>
          <input className="fi" style={{ padding: '6px 8px', fontSize: 13, fontWeight: 600 }} value={draft.name}
            onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} placeholder="Nombre del producto" autoFocus />
          {renderCategoryCell()}
          <input className="fi" type="number" min="0" style={{ padding: '6px 8px', fontSize: 12 }} value={draft.price_per_unit}
            onChange={e => setDraft(d => d && ({ ...d, price_per_unit: e.target.value }))} placeholder="Precio" />
          <select className="fi" style={{ padding: '6px 8px', fontSize: 12 }} value={draft.unit_type}
            onChange={e => setDraft(d => d && ({ ...d, unit_type: e.target.value }))}>
            <option value="kg">kg</option>
            <option value="unidad">Unidad</option>
            <option value="libra">Libra</option>
            <option value="bulto">Bulto</option>
            <option value="caja">Caja</option>
            <option value="canasta">Canasta</option>
            <option value="manojo">Manojo</option>
          </select>
          <StockToggle value={draft.in_stock} onChange={v => setDraft(d => d && ({ ...d, in_stock: v }))} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dc-btn" title="Crear producto" onClick={handleSubmit} disabled={save.isPending}
              style={{ borderColor: 'var(--v)', color: 'var(--v)' }}>
              <Check size={13} />
            </button>
            <button className="dc-btn" title="Cancelar" onClick={cancelEdit}
              style={{ borderColor: 'var(--r)', color: 'var(--r)' }}>
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          message={`¿Desactivar "${confirmDelete.name}"? El producto dejará de aparecer para nuevos pedidos. Los pedidos existentes que lo contienen no se ven afectados porque el nombre ya está guardado en cada pedido.`}
          onConfirm={() => del.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{(products as any[]).length} productos activos</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} color="var(--gt)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              className="fi"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              style={{ paddingLeft: 32, width: 220 }}
            />
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleExcelUpload} />
          <button className="bsec" title="Descargar el catálogo completo como Excel para editar precios fuera de línea"
            onClick={() => downloadProductsExcel(products as any[])} disabled={(products as any[]).length === 0}>
            <Download size={14} /> Excel
          </button>
          <button className="bsec" title="Subir un Excel descargado de aquí con precios actualizados"
            onClick={() => fileInputRef.current?.click()} disabled={uploadingExcel || bulkPrice.isPending}>
            <Upload size={14} /> {uploadingExcel || bulkPrice.isPending ? 'Subiendo...' : 'Subir precios'}
          </button>
          <button className="bnew" onClick={openCreate} disabled={editingId === '__new__'}>
            <Plus size={14} /> Nuevo producto
          </button>
        </div>
      </div>

      {/* La grilla usa columnas de ancho fijo (GRID_COLS) - en celular eso ya no
          cabe en la pantalla. En vez de achicar/apilar columnas (cambiaría cómo
          se ve y se edita en desktop), este wrapper deja que se desplace de
          lado en vez de desbordar la página - mismo resguardo que .ac ya usa
          para el tablero de Tickets & Pedidos. */}
      <div style={{ overflowX: 'auto' }}>
      {renderNewRow()}

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 24 }}>Cargando...</div>
      ) : (products as any[]).length === 0 ? (
        editingId === '__new__' ? null : (
          <div style={{ color: 'var(--gt)', fontSize: 14, padding: 16 }}>No hay productos. Crea el primero.</div>
        )
      ) : searchLower ? (
        filteredFlat.length === 0 ? (
          <div style={{ color: 'var(--gt)', fontSize: 14, padding: 16 }}>Sin resultados para "{search}"</div>
        ) : (
          <div style={{ border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, padding: '8px 14px', gap: 10, background: 'var(--gm)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--gt)' }}>
              <span>Nombre</span><span>Categoría</span><span>Precio</span><span>Unidad</span><span>Stock</span><span />
            </div>
            {filteredFlat.map(renderProductRow)}
          </div>
        )
      ) : (
        sortCategoryEntries(Object.entries(grouped)).map(([cat, prods]) => {
          const collapsed = !expandedCats.has(cat);
          return (
            <div key={cat} style={{ marginBottom: 12, border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
              {/* Category header - clickable to collapse */}
              <button
                onClick={() => toggleCat(cat)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--gm)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                {collapsed ? <ChevronRight size={15} color="var(--gt)" /> : <ChevronDown size={15} color="var(--gt)" />}
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--gt)', flex: 1 }}>{cat}</span>
                <span style={{ fontSize: 11, color: 'var(--gt)', fontWeight: 600 }}>{(prods as any[]).length} productos</span>
              </button>
              {!collapsed && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, padding: '6px 14px', gap: 10, borderTop: '1px solid var(--brd)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--gt)' }}>
                    <span>Nombre</span><span>Categoría</span><span>Precio</span><span>Unidad</span><span>Stock</span><span />
                  </div>
                  {(prods as any[]).map(renderProductRow)}
                </div>
              )}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}
