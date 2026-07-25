import { useState, useMemo, useEffect, useRef, useImperativeHandle, forwardRef, KeyboardEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { toast } from '../ui/Toast';
import { normalizeSearch } from '../../lib/normalize';

// A negative price must never make it into `items` at all - not just get blocked
// downstream at Guardar/Copiar/PDF/Enviar factura (defense-in-depth, still in place
// in DetallePedidoModal/NuevoPedidoModal) but rejected right here, at the only
// places a value actually commits: Enter and the ✓ button. An empty/non-numeric
// string isn't "negative" - that's the separate "no price set yet" case.
function isNegativePrice(priceStr: string | undefined): boolean {
  const n = parseFloat(priceStr ?? '');
  return !isNaN(n) && n < 0;
}

interface Product { id: string; name: string; category: string; }
interface Item { product_name: string; quantity_label: string; price: string; added_by_client?: boolean; }

interface Props {
  products: Product[];
  items: Item[];
  locked?: boolean;
  onChange: (items: Item[]) => void;
  onLocalDirty?: (dirty: boolean) => void;
  clearKey?: number;
}

// Exposed so a parent (NuevoPedidoModal/DetallePedidoModal) can force-commit
// whatever's mid-edit in the Factbox table right before it reads `items` to save -
// otherwise a row left open (typed but not confirmed with Enter/✓) was silently
// dropped by a direct click on the modal's own "Guardar" button: that button only
// ever read the `items` PROP, which commitEditField/saveEdit only update via
// onChange, a step the person never triggered. Returns the fully-merged array
// synchronously (not just via the onChange side effect) because the caller needs it
// in the SAME tick, before its own save fires - onChange's resulting setItems is
// only visible on the next render, too late for a save already about to happen.
export interface ProductSearchHandle {
  commitPendingEdit: () => Item[];
}

function groupByCategory(products: Product[]) {
  const order: string[] = [];
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); }
    groups[p.category].push(p);
  }
  return order.map(cat => ({ category: cat, products: groups[cat] }));
}

const ProductSearch = forwardRef<ProductSearchHandle, Props>(function ProductSearch(
  { products, items, locked, onChange, onLocalDirty, clearKey }, ref,
) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const factboxSearchRef = useRef<HTMLInputElement>(null);
  // Per-row refs for the CATALOG list (before adding) - unlike the Factbox below,
  // every catalog row is always "live" at once (no single editingRow), so this
  // needs a ref per product id, not one shared pair.
  const catalogQtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const catalogPriceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [localInputs, setLocalInputs] = useState<Record<string, { qty: string; price: string }>>({});
  // Which committed item (by product_name) is being edited inline in the Factbox
  // table below - editing never touches the catalog's collapsed state anymore, so
  // it stays collapsed by default the way the person left it.
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const editQtyRef = useRef<HTMLInputElement | null>(null);
  const editPriceRef = useRef<HTMLInputElement | null>(null);
  // Manual/off-catalog line - for when the product genuinely isn't in the DB list
  // yet (staff hasn't added it to Config > Productos). Lives at the end of the
  // Factbox, works the same regardless of the order's status (nuevo/preparando/
  // .../camino) - the only gate is `locked`, same as everything else in this file.
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualError, setManualError] = useState('');
  // Filters the Factbox table below (already-selected items), separate from the
  // catalog search above - lets staff quickly find one line to price on an order
  // with many items, instead of scrolling the whole committed list.
  const [factboxSearch, setFactboxSearch] = useState('');

  // Clear local inputs when parent signals a save (clearKey increments)
  useEffect(() => {
    if (clearKey == null) return;
    setLocalInputs({});
    onLocalDirty?.(false);
    setFactboxSearch('');
  }, [clearKey]);

  const grouped = useMemo(() => groupByCategory(products), [products]);
  const searchLower = normalizeSearch(search);

  const visibleGroups = useMemo(() => {
    if (!searchLower) return grouped;
    return grouped
      .map(g => ({
        category: g.category,
        products: g.products.filter(p =>
          normalizeSearch(p.name).includes(searchLower) ||
          normalizeSearch(p.category).includes(searchLower)
        ),
      }))
      .filter(g => g.products.length > 0);
  }, [grouped, searchLower]);

  // Notify parent when catalog has uncommitted typing
  useEffect(() => {
    const hasLocal = Object.values(localInputs).some(v => v.qty.trim() || v.price.trim());
    onLocalDirty?.(hasLocal);
  }, [localInputs, onLocalDirty]);

  function getLocal(name: string) {
    return localInputs[name] ?? { qty: '', price: '' };
  }

  function setLocal(name: string, field: 'qty' | 'price', val: string) {
    setLocalInputs(prev => ({ ...prev, [name]: { ...getLocal(name), [field]: val } }));
  }

  // Returns the resulting items array (not just void) - commitPendingEdit below
  // needs the ACTUAL merged list synchronously, not the state update this also
  // triggers via onChange, which only lands on the next render and would still be
  // stale to whatever reads `items` right after calling it in the same tick.
  // Returns null specifically when blocked (negative price) - distinct from the
  // legitimate "nothing typed" no-op (which returns `items` unchanged) - callers
  // that close the edit row on commit (saveEdit) need to tell those apart, so a
  // blocked attempt doesn't get silently discarded by closing the row anyway.
  function commitProduct(productName: string): Item[] | null {
    const local = localInputs[productName];
    if (isNegativePrice(local?.price)) {
      toast('El precio no puede ser negativo', true);
      return null;
    }
    // Nothing typed at all is only a no-op for a brand-new catalog row (nothing to
    // add yet). An EXISTING factbox item being edited must still commit even if
    // both fields end up cleared - otherwise the edit (e.g. clearing a stale price
    // down to nothing, meaning to leave it at 0) is silently discarded instead of
    // saved, and the row keeps showing its old value with no way to tell why.
    if (!local?.qty.trim() && !local?.price.trim() && !items.some(i => i.product_name === productName)) {
      return items;
    }

    // Preserve provenance - staff editing qty/price on a line the client added
    // (typically filling in the price, which the client's form never sets) must not
    // silently clear the flag that marks it as a client-originated change.
    const priorItem = items.find(i => i.product_name === productName);
    const newItem: Item = {
      product_name: productName,
      quantity_label: local.qty.trim(),
      // Left blank -> 0, same reasoning as commitEditField below: a blank price
      // must never be what actually blocks saving the order.
      price: local.price.trim() || '0',
      added_by_client: priorItem?.added_by_client ?? false,
    };

    const exists = items.some(i => i.product_name === productName);
    const next = exists
      ? items.map(i => i.product_name === productName ? newItem : i)
      : [...items, newItem];
    onChange(next);

    // Clear local input so the catalog row goes back to empty
    setLocalInputs(prev => {
      const copy = { ...prev };
      delete copy[productName];
      return copy;
    });

    // Return focus to search bar so user can quickly find next product (a no-op if
    // the catalog is collapsed, e.g. when this commit came from an inline Factbox edit)
    setSearch('');
    requestAnimationFrame(() => searchRef.current?.focus());
    return next;
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>, productName: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitProduct(productName);
    }
  }

  // Flat, visible-order list of catalog products (grouped by category above,
  // this flattens across group boundaries) - drives Up/Down navigation the same
  // way the Factbox's own moveToRow does against visibleItems.
  const flatVisibleProducts = useMemo(() => visibleGroups.flatMap(g => g.products), [visibleGroups]);

  // Shared by both inputs of a CATALOG row (not yet added - every row is "live"
  // at once here, unlike the Factbox's single editingRow). Left/Right toggle
  // qty<->price on the same row; Up/Down move to the row above/below in the same
  // column, landing in the top search bar at the very top boundary.
  function handleCatalogArrowKeys(e: KeyboardEvent<HTMLInputElement>, product: Product, field: 'qty' | 'price') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = flatVisibleProducts.findIndex(p => p.id === product.id);
      if (idx < 0) return;
      if (e.key === 'ArrowUp' && idx === 0) {
        searchRef.current?.focus();
        return;
      }
      const next = flatVisibleProducts[e.key === 'ArrowUp' ? idx - 1 : idx + 1];
      if (!next) return;
      const ref = field === 'qty' ? catalogQtyRefs : catalogPriceRefs;
      ref.current[next.id]?.focus();
      ref.current[next.id]?.select();
      return;
    }
    if (e.key === 'ArrowRight' && field === 'qty') {
      // Boundary-aware - qty is type="text", so selectionStart is reliable: only
      // jump to price once the cursor has nowhere further right to go within qty.
      const input = e.currentTarget;
      if (input.selectionStart !== input.value.length) return;
      e.preventDefault();
      catalogPriceRefs.current[product.id]?.focus();
      catalogPriceRefs.current[product.id]?.select();
      return;
    }
    if (e.key === 'ArrowLeft' && field === 'price') {
      // Unconditional, same reasoning as the Factbox's own price->qty jump -
      // type="number" doesn't reliably expose selectionStart across browsers.
      e.preventDefault();
      catalogQtyRefs.current[product.id]?.focus();
      catalogQtyRefs.current[product.id]?.select();
    }
  }

  function removeItem(productName: string) {
    onChange(items.filter(i => i.product_name !== productName));
  }

  // Which field to focus once editingRow actually changes (the effect below can't
  // take a parameter, since it just reacts to state) - defaults to qty (pencil
  // click, or clicking the quantity value itself), set to 'price' right before
  // switching rows via an arrow key so landing on the new row lands in the same
  // column the person was already in.
  const editFocusField = useRef<'qty' | 'price'>('qty');

  function editItem(item: Item, field: 'qty' | 'price' = 'qty') {
    // A price of "0" (unset) showed literally as "0" in the input, forcing whoever's
    // typing to delete it first - show it empty instead, same as a genuinely unset one.
    const priceVal = parseFloat(item.price) > 0 ? item.price : '';
    setLocalInputs(prev => ({ ...prev, [item.product_name]: { qty: item.quantity_label, price: priceVal } }));
    onLocalDirty?.(true);
    editFocusField.current = field;
    setEditingRow(item.product_name);
  }

  // Commits the currently-typed qty/price for a row WITHOUT closing its edit mode -
  // used when Enter just advances focus to the next field, not when the person is
  // done with the whole row (that's saveEdit, which also calls this then closes).
  // Returns false when blocked (negative price) - callers (advanceToPrice/
  // advanceToNextRow) must NOT move focus away in that case, so the person stays
  // right on the bad value instead of it silently vanishing to the next field.
  function commitEditField(productName: string): boolean {
    const local = localInputs[productName];
    if (local === undefined) return true;
    if (isNegativePrice(local.price)) {
      toast('El precio no puede ser negativo', true);
      return false;
    }
    const priorItem = items.find(i => i.product_name === productName);
    const newItem: Item = {
      product_name: productName,
      quantity_label: local.qty.trim(),
      // Left blank -> 0 immediately, not just at save time - staff shouldn't have
      // to type a price to move on, and a blank value must never be what blocks
      // saving the order.
      price: local.price.trim() || '0',
      added_by_client: priorItem?.added_by_client ?? false,
    };
    onChange(items.map(i => i.product_name === productName ? newItem : i));
    return true;
  }

  // Enter in the qty field of a row being edited: save qty, jump to price - same row.
  function advanceToPrice(productName: string) {
    if (!commitEditField(productName)) return;
    requestAnimationFrame(() => { editPriceRef.current?.focus(); editPriceRef.current?.select(); });
  }

  // Enter in the price field: save, then open the NEXT row's qty field straight into
  // edit mode - the editingRow effect below already focuses editQtyRef whenever
  // editingRow changes, so opening the next row is all this needs to do.
  function advanceToNextRow(productName: string) {
    if (!commitEditField(productName)) return;
    // visibleItems (the factbox-search-filtered list), not the full unfiltered
    // items - matches moveToRow's own arrow-key navigation below, which already
    // gets this right; Enter didn't, and disagreeing about which row is "next"
    // depending on whether Enter or an arrow key was pressed made no sense.
    const idx = visibleItems.findIndex(i => i.product_name === productName);
    const next = idx >= 0 ? visibleItems[idx + 1] : undefined;
    if (next) { editItem(next); return; }
    // Last row - nothing to advance to, but editingRow is left exactly as it
    // was (still this row) instead of closing to null. Closing it used to kill
    // keyboard nav dead: the input unmounts, focus falls to nowhere, and arrow
    // keys stop doing anything until the person clicks something again.
  }

  // Up/Down between rows, same column: commits whatever's typed in the row being
  // left (same as Enter does) - moving away from a row must never silently drop
  // what was just typed there, and NOT move at all if that commit is blocked
  // (negative price), matching advanceToPrice/advanceToNextRow's own guard.
  // Navigates the FILTERED (visibleItems) list, not the full unfiltered one - the
  // point of the factbox search box is to narrow down which rows arrow-nav even
  // reaches.
  function moveToRow(fromProductName: string, direction: 'up' | 'down', field: 'qty' | 'price') {
    if (!commitEditField(fromProductName)) return;
    const idx = visibleItems.findIndex(i => i.product_name === fromProductName);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) {
      // Clear editingRow (not just move focus) - if this row was already the one
      // in edit mode, calling editItem on it again from the search box's ArrowDown
      // (same product_name) would be a no-op setState, and the effect that focuses
      // the field only fires when editingRow actually CHANGES. Without this, arrowing
      // up to the search box then back down landed nowhere.
      setEditingRow(null);
      factboxSearchRef.current?.focus();
      return;
    }
    const next = visibleItems[direction === 'up' ? idx - 1 : idx + 1];
    if (next) editItem(next, field);
  }

  // Shared by both the qty and price inputs of a row being edited. Enter/Escape
  // behavior is unchanged (still per-field, see advanceToPrice/advanceToNextRow/
  // cancelEdit); this adds arrow-key movement between editable fields:
  // Left/Right toggle qty<->price on the SAME row, Up/Down move to the row
  // above/below in the SAME column.
  function handleEditArrowKeys(e: KeyboardEvent<HTMLInputElement>, productName: string, field: 'qty' | 'price') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveToRow(productName, e.key === 'ArrowUp' ? 'up' : 'down', field);
      return;
    }
    if (e.key === 'ArrowRight' && field === 'qty') {
      // Boundary-aware: a plain ArrowRight while there's still text ahead of the
      // cursor must move the cursor through the text like normal, same as any
      // other input - only jump fields once there's nowhere left to move within
      // this one. (Qty is a text input, so selectionStart is reliable here.)
      const input = e.currentTarget;
      if (input.selectionStart !== input.value.length) return;
      e.preventDefault();
      editFocusField.current = 'price';
      editPriceRef.current?.focus();
      editPriceRef.current?.select();
      return;
    }
    if (e.key === 'ArrowLeft' && field === 'price') {
      // Price is type="number" - selectionStart isn't reliably readable on that
      // input type across browsers, so this jumps unconditionally rather than
      // risk throwing/silently doing nothing on a boundary check that can't be
      // trusted here. Prices are short and usually retyped fresh (select() on
      // focus already selects everything), so this is a fair trade-off.
      e.preventDefault();
      editFocusField.current = 'qty';
      editQtyRef.current?.focus();
      editQtyRef.current?.select();
    }
  }

  function cancelEdit(productName: string) {
    setLocalInputs(prev => {
      const copy = { ...prev };
      delete copy[productName];
      return copy;
    });
    setEditingRow(null);
  }

  // Returns null when blocked (negative price) too, same as commitProduct - the ✓
  // button must leave the row open on a rejected value instead of closing over it
  // and silently reverting to whatever the item was before.
  function saveEdit(productName: string): Item[] | null {
    const next = commitProduct(productName);
    if (next === null) return null;
    setEditingRow(null);
    return next;
  }

  useImperativeHandle(ref, () => ({
    // Falls back to the current `items` (not null) when blocked - the modal's own
    // Guardar just proceeds without that particular edit rather than erroring out;
    // the person already saw the "no puede ser negativo" toast and the row stayed
    // open with their bad value still in it for them to fix.
    commitPendingEdit: () => (editingRow ? saveEdit(editingRow) : items) ?? items,
  }));

  function addManualProduct() {
    const name = manualName.trim();
    if (!name) return;
    if (isNegativePrice(manualPrice)) {
      setManualError('El precio no puede ser negativo.');
      return;
    }
    // Items are keyed by product_name throughout this file (React key, edit/remove
    // lookups) - a manual entry colliding with an existing line would silently merge
    // into/overwrite it instead of adding a new one.
    if (items.some(i => i.product_name.toLowerCase() === name.toLowerCase())) {
      setManualError('Ya hay un producto con ese nombre en el pedido - edítalo en la tabla de arriba.');
      return;
    }
    setManualError('');
    onChange([...items, { product_name: name, quantity_label: manualQty.trim(), price: manualPrice.trim() }]);
    setManualName(''); setManualQty(''); setManualPrice('');
  }

  useEffect(() => {
    if (!editingRow) return;
    const ref = editFocusField.current === 'price' ? editPriceRef : editQtyRef;
    ref.current?.focus();
    ref.current?.select();
  }, [editingRow]);

  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const factboxSearchLower = normalizeSearch(factboxSearch);
  const visibleItems = useMemo(
    () => factboxSearchLower ? items.filter(i => normalizeSearch(i.product_name).includes(factboxSearchLower)) : items,
    [items, factboxSearchLower],
  );

  // Locked mode: read-only table
  if (locked) {
    return (
      <div style={{ border: '1px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Producto</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>Cantidad</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)' }}>Precio</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '12px', color: 'var(--gt)', textAlign: 'center' }}>Sin productos</td></tr>
            )}
            {items.map((i, idx) => (
              <tr key={i.product_name} style={{ background: idx % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                <td style={{ padding: '9px 12px', fontWeight: 600, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined }}>
                  {i.product_name}
                  {i.added_by_client && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cliente</span>}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center', color: i.added_by_client ? '#DC2626' : 'var(--vd)', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>{i.quantity_label || '-'}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined }}>{parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '-'}</td>
              </tr>
            ))}
            {items.length > 0 && (
              <tr style={{ background: 'var(--vc)' }}>
                <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--vd)', borderRight: '1px solid var(--brd)' }}>Total</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--vd)', fontSize: 14 }}>${total.toLocaleString('es-CO')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {/* Catalog toggle header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--rad)',
          border: '1px solid var(--brd)', marginBottom: 6, userSelect: 'none',
          fontSize: 13, fontWeight: 700, color: 'var(--n)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transition: 'transform .2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Catálogo - escribe cantidad y precio
        {items.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 8px' }}>
            {items.length} ítem{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="psearch" style={{ marginBottom: 7 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gt)" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input ref={searchRef} type="text" placeholder="Filtrar catálogo..." value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' && flatVisibleProducts.length > 0) {
                  e.preventDefault();
                  const first = flatVisibleProducts[0];
                  catalogQtyRefs.current[first.id]?.focus();
                }
              }} />
            {search && (
              <button onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: 18, color: 'var(--gt)', lineHeight: 1 }}>
                ×
              </button>
            )}
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', marginBottom: 12 }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 120px 110px 32px', gap: 8,
              padding: '7px 12px', background: 'var(--b)', borderBottom: '2px solid var(--brd)',
              position: 'sticky', top: 0, zIndex: 2,
              fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.4px',
            }}>
              <div>Producto</div><div>Cantidad</div><div>Precio</div><div></div>
            </div>

            {visibleGroups.length === 0 && (
              <div style={{ padding: '12px 13px', fontSize: 13, color: 'var(--gt)' }}>Sin resultados para "{search}"</div>
            )}

            {visibleGroups.map(group => (
              <div key={group.category}>
                <div style={{
                  background: 'var(--bg)', color: 'var(--gt)', fontWeight: 800, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  padding: '7px 12px', borderBottom: '1px solid var(--brd)', borderTop: '1px solid var(--brd)',
                }}>
                  {group.category}
                </div>
                {group.products.map(p => {
                  const local = getLocal(p.name);
                  const isCommitted = items.some(i => i.product_name === p.name);
                  const hasLocal = !!(local.qty.trim() || local.price.trim());
                  return (
                    <div key={p.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 120px 110px 32px', gap: 8,
                      padding: '7px 12px', borderBottom: '1px solid var(--brd)', alignItems: 'center',
                      background: isCommitted ? 'var(--vc)' : 'var(--b)', transition: 'background .1s',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: isCommitted ? 700 : 400, color: isCommitted ? 'var(--vd)' : 'var(--n)' }}>
                        {p.name}
                        {isCommitted && <Check size={11} color="var(--v)" style={{ marginLeft: 5, display: 'inline', verticalAlign: 'middle' }} />}
                      </div>
                      <input
                        ref={el => { catalogQtyRefs.current[p.id] = el; }}
                        className="iinput"
                        placeholder="Ej: 2 kg"
                        value={local.qty}
                        onChange={e => setLocal(p.name, 'qty', e.target.value)}
                        onKeyDown={e => { handleKey(e, p.name); handleCatalogArrowKeys(e, p, 'qty'); }}
                        style={{ fontSize: 13 }}
                      />
                      <input
                        ref={el => { catalogPriceRefs.current[p.id] = el; }}
                        className="iinput no-spin"
                        placeholder="$0"
                        type="number"
                        min="0"
                        value={local.price}
                        onChange={e => setLocal(p.name, 'price', e.target.value)}
                        onKeyDown={e => { handleKey(e, p.name); handleCatalogArrowKeys(e, p, 'price'); }}
                        style={{ fontSize: 13 }}
                      />
                      {/* Confirm button */}
                      <button
                        onClick={() => commitProduct(p.name)}
                        disabled={!hasLocal}
                        style={{
                          width: 26, height: 26, borderRadius: '50%', border: 'none',
                          background: hasLocal ? 'var(--v)' : 'var(--brd)',
                          color: hasLocal ? '#fff' : 'var(--gt)',
                          cursor: hasLocal ? 'pointer' : 'default',
                          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all .15s',
                        }}
                        title="Agregar al pedido (o presiona Enter)"
                      >
                        <Check size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Factbox - committed items table with edit/remove */}
      {items.length > 0 && (
        <div className="psearch" style={{ marginBottom: 7 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gt)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={factboxSearchRef}
            type="text"
            placeholder="Buscar entre los productos del pedido..."
            value={factboxSearch}
            onChange={e => setFactboxSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && visibleItems.length > 0) {
                e.preventDefault();
                editItem(visibleItems[0], 'qty');
              }
            }}
          />
          {factboxSearch && (
            <button onClick={() => setFactboxSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: 18, color: 'var(--gt)', lineHeight: 1 }}>
              ×
            </button>
          )}
        </div>
      )}
      <div style={{ border: '1px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 14 }}>
        {/* table-layout:fixed + explicit column widths - without this, a very long
            quantity_label (free text is allowed now, not just "10 Kilo") makes
            auto layout grow that COLUMN (and the whole table) to fit it, eating
            into the Producto column's space. With fixed layout, a long value wraps
            to more LINES within its own column instead - same trade the invoice
            PDF already makes (splitTextToSize + row height growth). */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ width: '44%', textAlign: 'left', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Producto</th>
              <th style={{ width: '28%', textAlign: 'center', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Cantidad</th>
              <th style={{ width: '22%', textAlign: 'right', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Precio</th>
              <th style={{ padding: '8px 6px', borderBottom: '2px solid var(--brd)', width: 52 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '12px', color: 'var(--gt)', textAlign: 'center', fontSize: 12 }}>
                Filtra el catálogo, llena cantidad/precio y presiona Enter para agregar
              </td></tr>
            )}
            {items.length > 0 && visibleItems.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '12px', color: 'var(--gt)', textAlign: 'center', fontSize: 12 }}>
                Sin resultados para "{factboxSearch}"
              </td></tr>
            )}
            {visibleItems.map((i, idx) => {
              const isEditing = editingRow === i.product_name;
              const local = getLocal(i.product_name);
              return (
                <tr key={i.product_name} style={{ background: idx % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                  <td style={{ padding: '9px 12px', fontWeight: 600, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined, wordBreak: 'break-word' }}>
                    {i.product_name}
                    {i.added_by_client && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cliente</span>}
                  </td>
                  <td style={{ padding: isEditing ? '5px 8px' : '9px 12px', textAlign: 'center', color: i.added_by_client ? '#DC2626' : 'var(--vd)', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>
                    {isEditing ? (
                      <input
                        ref={editQtyRef}
                        className="iinput"
                        placeholder="Ej: 2 kg"
                        value={local.qty}
                        onChange={e => setLocal(i.product_name, 'qty', e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); advanceToPrice(i.product_name); return; }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(i.product_name); return; }
                          handleEditArrowKeys(e, i.product_name, 'qty');
                        }}
                        style={{ fontSize: 13, width: '100%', textAlign: 'center' }}
                      />
                    ) : (
                      // Click the value directly to edit it - no longer required to
                      // hit the pencil icon first (that button still works too).
                      <span onClick={() => editItem(i, 'qty')} style={{ cursor: 'pointer', display: 'block', wordBreak: 'break-word' }} title="Clic para editar">
                        {i.quantity_label || '-'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: isEditing ? '5px 8px' : '9px 12px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: !isEditing && i.added_by_client ? '#DC2626' : undefined }}>
                    {isEditing ? (
                      <input
                        ref={editPriceRef}
                        className="iinput no-spin"
                        placeholder="$0"
                        type="number"
                        min="0"
                        value={local.price}
                        onChange={e => setLocal(i.product_name, 'price', e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); advanceToNextRow(i.product_name); return; }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(i.product_name); return; }
                          handleEditArrowKeys(e, i.product_name, 'price');
                        }}
                        style={{ fontSize: 13, width: '100%', textAlign: 'right' }}
                      />
                    ) : (
                      <span onClick={() => editItem(i, 'price')} style={{ cursor: 'pointer', display: 'block' }} title="Clic para editar">
                        {parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '-'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid var(--brd)', textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(i.product_name)} title="Guardar (o Enter)"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => cancelEdit(i.product_name)} title="Cancelar (o Esc)"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => editItem(i)} title="Editar"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--az)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => removeItem(i.product_name)} title="Quitar"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', display: 'flex', alignItems: 'center', padding: 2, fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr style={{ background: 'var(--vc)' }}>
                <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--vd)', borderRight: '1px solid var(--brd)' }}>Total</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--vd)', fontSize: 14 }}>${total.toLocaleString('es-CO')}</td>
                <td style={{ borderLeft: '1px solid var(--brd)' }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Manual/off-catalog product - for when it's genuinely not in the list yet */}
      <div style={{ border: '1px dashed var(--brd)', borderRadius: 'var(--rad)', padding: '10px 12px', marginTop: -6, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', marginBottom: 7 }}>
          ¿No está en el catálogo? Agrégalo manual
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 110px 32px', gap: 8, alignItems: 'center' }}>
          <input
            className="iinput"
            placeholder="Nombre del producto"
            value={manualName}
            onChange={e => { setManualName(e.target.value); setManualError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualProduct(); } }}
            style={{ fontSize: 13 }}
          />
          <input
            className="iinput"
            placeholder="Ej: 2 kg"
            value={manualQty}
            onChange={e => setManualQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualProduct(); } }}
            style={{ fontSize: 13 }}
          />
          <input
            className="iinput no-spin"
            placeholder="$0"
            type="number"
            min="0"
            value={manualPrice}
            onChange={e => setManualPrice(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualProduct(); } }}
            style={{ fontSize: 13 }}
          />
          <button
            onClick={addManualProduct}
            disabled={!manualName.trim()}
            title="Agregar producto manual (o presiona Enter)"
            style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: manualName.trim() ? 'var(--v)' : 'var(--brd)',
              color: manualName.trim() ? '#fff' : 'var(--gt)',
              cursor: manualName.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Check size={13} />
          </button>
        </div>
        {manualError && (
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 700, marginTop: 6 }}>{manualError}</div>
        )}
      </div>
    </>
  );
});

export default ProductSearch;
