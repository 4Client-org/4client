import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { sortCategoryEntries } from '../../lib/categoryOrder';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmDialog } from './ConfirmDialog';

// ─── Products ────────────────────────────────────────────────────────────────

// Column widths shared by the header row and every product row (view AND edit
// mode) so cells line up regardless of which rows are currently mid-edit.
const GRID_COLS = '1fr 170px 120px 110px 100px';

interface ProductForm {
  name: string;
  category: string;
  newCategory: string;
  useNewCategory: boolean;
  price_per_unit: string;
  unit_type: string;
}

const EMPTY_FORM = (existingCategories: string[]): ProductForm => ({
  name: '',
  category: existingCategories[0] ?? '',
  newCategory: '',
  useNewCategory: existingCategories.length === 0,
  price_per_unit: '',
  unit_type: 'kg',
});

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

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setConfirmDelete(null);
      toast('Producto desactivado');
    },
    onError: (e: any) => { setConfirmDelete(null); toast(e.message, true); },
  });

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

  // Category `<select>` used by an editing row - same "existing category OR type
  // a new one" toggle the old shared form used, just embedded in one grid cell.
  function CategoryCell() {
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
        <select className="fi" style={{ padding: '6px 8px', fontSize: 12, flex: 1 }} value={draft.category}
          onChange={e => setDraft(d => d && ({ ...d, category: e.target.value }))}>
          {existingCategories.length === 0 && <option value="">Sin categoría</option>}
          {existingCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
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
          <CategoryCell />
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dc-btn" title="Guardar cambios" onClick={handleSubmit} disabled={save.isPending}
              style={{ borderColor: 'var(--v)', color: 'var(--v)' }}>
              <Check size={13} />
            </button>
            <button className="dc-btn" title="Cancelar" onClick={cancelEdit}>
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
          <CategoryCell />
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="dc-btn" title="Crear producto" onClick={handleSubmit} disabled={save.isPending}
              style={{ borderColor: 'var(--v)', color: 'var(--v)' }}>
              <Check size={13} />
            </button>
            <button className="dc-btn" title="Cancelar" onClick={cancelEdit}>
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
          <button className="bnew" onClick={openCreate} disabled={editingId === '__new__'}>
            <Plus size={14} /> Nuevo producto
          </button>
        </div>
      </div>

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
              <span>Nombre</span><span>Categoría</span><span>Precio</span><span>Unidad</span><span />
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
                    <span>Nombre</span><span>Categoría</span><span>Precio</span><span>Unidad</span><span />
                  </div>
                  {(prods as any[]).map(renderProductRow)}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
