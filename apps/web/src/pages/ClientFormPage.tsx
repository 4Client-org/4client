import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { ShoppingCart, CheckCircle, XCircle, Check, Trash2, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { resolveApiBase } from '../lib/apiBase';
import { normalizeSearch } from '../lib/normalize';

const API = resolveApiBase();

interface Product { id: string; name: string; category: string; unit_type?: string | null; }
interface SelectedItem { product_name: string; quantity_label: string; productId: string; isManual?: boolean; }
interface DayOrderItem { id: string; product_name: string; quantity_label: string; price: number; }
interface LastOrderItem { product_name: string; quantity_label: string; available: boolean; }
interface DayOrder {
  id: string; num: string; address: string; paymentMethod: string;
  status: string; editable: boolean; items: DayOrderItem[]; createdAt: string;
}

const UNIT_OPTIONS = ['Kilo', 'Libra', 'Unidad', 'Paquete', 'Bulto', 'Bandeja', 'Canasta', 'Pesos $'];
const DEFAULT_UNIT = 'Kilo';

// Fijo por ahora - una sola organización real hoy. Cuando haya un segundo
// cliente en la plataforma, esto pasa a ser un campo de Organization (URL de
// política propia por negocio) en vez de una constante compartida acá.
const PRIVACY_POLICY_URL = 'https://4client-org.github.io/fruver-san-gabriel-web/politica-privacidad.html';

const STATUS_LABEL_CLIENT: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo para entrega',
  camino: 'En camino', cerrado: 'Entregado',
};

function groupByCategory(products: Product[]) {
  const order: string[] = [];
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    const cat = p.category || 'Otros';
    if (!groups[cat]) { groups[cat] = []; order.push(cat); }
    groups[cat].push(p);
  }
  return order.map(cat => ({ category: cat, products: groups[cat] }));
}

// Random value this browser generates once per link and keeps in localStorage -
// there's no real "device identity" reachable from a web page, so this is the
// closest available proxy. Kept and still sent on every request (backend still
// records it against submitted/deleted orders for traceability), but the backend
// no longer REJECTS a request over it - a link can be opened/used from more than
// one device/browser at once (see public.ts's own comment on this).
function getOrCreateDeviceToken(token: string): string {
  const key = `4client_device_${token}`;
  const fresh = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    let dt = localStorage.getItem(key);
    if (!dt) { dt = fresh(); localStorage.setItem(key, dt); }
    return dt;
  } catch {
    return fresh(); // localStorage unavailable (private mode) - works for this load, just won't persist
  }
}

export default function ClientFormPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const deviceToken = useMemo(() => getOrCreateDeviceToken(token), [token]);
  const draftKey = `4client_form_draft_${token}`;
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  const [state, setState] = useState<'loading' | 'invalid' | 'catalog' | 'done' | 'deleted'>('loading');
  const [clientName, setClientName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [dayOrders, setDayOrders] = useState<DayOrder[]>([]);
  // Opt-in only - fetched eagerly (cheap, same request pattern as form-info/
  // products) but never auto-applied to `selected`. Null until loaded, then
  // either an item list or an empty array (nothing to repeat).
  const [lastOrder, setLastOrder] = useState<LastOrderItem[] | null>(null);
  // Ley 1581 de 2012 - true hasta que sepamos lo contrario, para no parpadear
  // el checkbox de consentimiento antes de que cargue form-info (la mayoría de
  // los links son de clientes que ya aceptaron en un pedido anterior).
  const [hasConsent, setHasConsent] = useState(true);
  const [consentChecked, setConsentChecked] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  // null = not decided yet; 'new' = a separate order; any other value = the id of
  // the existing order being edited. There's no "choose which order" menu
  // anymore - this is resolved automatically (resolveTarget below) straight into
  // whichever order is actually editable, or a fresh one if none is.
  const [mergeTarget, setMergeTarget] = useState<string | 'new' | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  // pending input per product (not confirmed yet)
  const [pendingQty, setPendingQty] = useState<Record<string, string>>({});
  // unit chosen per product, independent of pendingQty so switching rows (arrow
  // nav, focus loss) never wipes what's already typed/chosen in another row.
  const [pendingUnit, setPendingUnit] = useState<Record<string, string>>({});
  // confirmed items list
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  // "Agregar producto no listado" - lets the client type a product that isn't in
  // the catalog at all, sent with is_manual so the backend flags it added_by_client
  // (same red highlight staff sees for any other client edit) - it needs a price/
  // review they can't get from the catalog lookup.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // Live-update banner - set when a background poll (see the effect below) notices
  // the order being edited changed state (e.g. staff moved it to "camino") while
  // this tab sat open. Separate from submitError: this is a standing warning shown
  // the moment we find out, not just something surfaced after a failed submit.
  const [liveWarning, setLiveWarning] = useState('');
  // becomes true once we've attempted to restore a persisted draft, so the
  // persistence effect below doesn't clobber a saved draft with the initial empty state
  const [hydrated, setHydrated] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Refs for arrow-key navigation: catalog rows keyed by product id (qty input +
  // unit select), plus the flat visible order so Up/Down know which row is
  // "next"/"previous" across category boundaries. Selected-items rows keyed by
  // productId too, for Up/Down inside that list and to jump back into the
  // matching catalog row's editable fields.
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const unitSelectRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  const selectedRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Synchronous guard against a double-click/tap firing two submits before React's
  // next render commits the `submitting` state update - a plain state check at the
  // top of handleSubmit can't catch that, since both click handlers can read the
  // stale `false` value in the same tick. A ref updates immediately, no render lag.
  const submittingRef = useRef(false);

  // Shared by the initial load, continueToForm ("Ver mis pedidos" / "Hacer un
  // pedido" buttons) and deleteEntireOrder - fetches the client's current info,
  // products and orders. Returns products TOO (not just orders), not just via the
  // `products` state - applyTarget (below) needs the freshly-fetched list to map
  // product names to ids for prefill, and reading the `products` STATE variable
  // right after calling setProducts() here would still see the stale pre-update
  // value in the same tick (React state updates aren't synchronous).
  async function loadFormInfo(): Promise<{ orders: DayOrder[]; products: Product[] } | null> {
    const qs = `t=${encodeURIComponent(token)}&device_token=${encodeURIComponent(deviceToken)}`;
    try {
      const [info, prods, lastOrderRes] = await Promise.all([
        fetch(`${API}/api/v1/public/form-info?${qs}`).then(r => r.json()),
        fetch(`${API}/api/v1/public/products?${qs}`).then(r => r.json()),
        // Best-effort - a failure here must never block the form itself, this is
        // a nice-to-have convenience button, not part of the core flow.
        fetch(`${API}/api/v1/public/last-order?${qs}`).then(r => r.json()).catch(() => ({ data: null })),
      ]);
      setLastOrder(lastOrderRes?.data?.items ?? null);
      if (!info.data?.clientName) {
        setState('invalid');
        setErrorMsg(info.error ?? 'Link inválido o expirado.');
        return null;
      }
      setClientName(info.data.clientName);
      setOrgName(info.data.orgName ?? '');
      setHasConsent(!!info.data.hasConsent);
      const prodList: Product[] = prods.data ?? [];
      setProducts(prodList);
      const orders: DayOrder[] = info.data.orders ?? [];
      setDayOrders(orders);
      return { orders, products: prodList };
    } catch {
      setState('invalid');
      setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.');
      return null;
    }
  }

  // The client's very first editable order today, or 'new' if there isn't one -
  // there's no menu to pick from anymore, this is the whole decision. Matches what
  // staff's own "crear pedido" dedup does on the board side (open the existing
  // resumable order instead of creating a duplicate).
  function resolveTarget(orders: DayOrder[]): string | 'new' {
    const editable = orders.find(o => o.editable);
    return editable ? editable.id : 'new';
  }

  // Loads whichever target resolveTarget (or a restored draft) points at into the
  // actual form fields - pulling in what's already on that order (address/pago/
  // items) so the client sees/edits what's really there instead of a blank slate,
  // or resetting to a clean new order.
  function applyTarget(target: string | 'new', orders: DayOrder[], prods: Product[]) {
    setMergeTarget(target);
    if (target !== 'new') {
      const order = orders.find(o => o.id === target);
      if (order) {
        setAddress(order.address || '');
        setPaymentMethod(order.paymentMethod || '');
        setSelected(order.items.map(i => ({
          product_name: i.product_name,
          quantity_label: i.quantity_label,
          productId: prods.find(p => p.name === i.product_name)?.id ?? `existing-${i.id}`,
        })));
        return;
      }
    }
    setSelected([]);
    setAddress('');
    setPaymentMethod('');
  }

  // Opt-in "Repetir mi último pedido" - only items come back (see last-order's
  // own comment for why price/address/payment_method deliberately don't). An
  // item no longer in the active catalog is silently skipped rather than
  // loaded broken - `available` (from the backend) is exactly this check
  // already done once server-side, no need to re-derive it against `products`.
  function applyLastOrder() {
    if (!lastOrder) return;
    setSelected(lastOrder.filter(i => i.available).map((i, idx) => ({
      product_name: i.product_name,
      quantity_label: i.quantity_label,
      productId: products.find(p => p.name === i.product_name)?.id ?? `repeat-${idx}`,
    })));
  }

  useEffect(() => {
    if (!token) { setState('invalid'); setErrorMsg('Link inválido. Pide un nuevo link al negocio.'); return; }

    // Read synchronously (not via state, which wouldn't be committed yet in this
    // same effect) so the branch below can tell whether there's an in-progress
    // draft to resume straight back into, instead of resolving a fresh target.
    let restoredMergeTarget: string | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && Array.isArray(draft.items) && typeof draft.savedAt === 'number' && Date.now() - draft.savedAt < DRAFT_MAX_AGE_MS) {
          setSelected(draft.items);
          if (typeof draft.address === 'string') setAddress(draft.address);
          if (typeof draft.paymentMethod === 'string') setPaymentMethod(draft.paymentMethod);
          if (typeof draft.mergeTarget === 'string') {
            restoredMergeTarget = draft.mergeTarget;
            setMergeTarget(draft.mergeTarget as any);
          }
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* localStorage unavailable (private mode, etc.) - ignore */ }
    setHydrated(true);

    // Checked before loading form-info so a blocked/expired link shows "Link
    // inválido" with its specific reason, rather than a generic failure.
    fetch(`${API}/api/v1/public/link-status?t=${encodeURIComponent(token)}`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setState('invalid'); setErrorMsg(body.error ?? 'Link inválido o expirado.'); return; }
        return loadFormInfo().then(result => {
          if (result === null) return;
          if (!restoredMergeTarget) {
            applyTarget(resolveTarget(result.orders), result.orders, result.products);
          }
          setState('catalog');
          setTimeout(() => searchRef.current?.focus(), 100);
        });
      })
      .catch(() => { setState('invalid'); setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.'); });
  }, [token]);

  // From the "¡Pedido enviado!"/"Pedido eliminado" screens back into a live form -
  // always straight to the form (a still-editable order, or a fresh one), never a
  // menu to choose from.
  async function continueToForm() {
    setState('loading');
    const result = await loadFormInfo();
    if (result === null) return; // loadFormInfo already switched to 'invalid'
    applyTarget(resolveTarget(result.orders), result.orders, result.products);
    setState('catalog');
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  // Persist confirmed items as a draft so the client can resume within 1 day
  // if they close the tab mid-order. Skip until the initial restore attempt
  // above has run, so we don't overwrite a saved draft with the empty initial state.
  // Runs on every keystroke in address/items too (not just on blur/submit) - a
  // refresh mid-typing must never lose more than what's still sitting unsent in a
  // single uncommitted catalog row.
  useEffect(() => {
    if (!hydrated || !token) return;
    try {
      if (selected.length === 0 && !address && !paymentMethod) {
        localStorage.removeItem(draftKey);
      } else {
        localStorage.setItem(draftKey, JSON.stringify({ items: selected, address, paymentMethod, mergeTarget, savedAt: Date.now() }));
      }
    } catch { /* localStorage unavailable - ignore, form still works without persistence */ }
  }, [selected, address, paymentMethod, mergeTarget, hydrated, token]);

  // Live-update: poll for status changes on the client's order(s) - both while
  // choosing which one to edit and while actively editing one - so a board change
  // (e.g. staff marks it "camino") shows up right away instead of only surfacing at
  // submit time via a rejected request. There's no authenticated public socket
  // channel a stranger holding just a link could safely join, so this is a fast poll
  // rather than a push - 5s reads as close to instant without adding new public
  // attack surface. Doesn't touch `selected`/`address`/`paymentMethod` - never
  // stomps whatever the client is mid-typing.
  useEffect(() => {
    if (state !== 'catalog' || !token) return;
    const qs = `t=${encodeURIComponent(token)}&device_token=${encodeURIComponent(deviceToken)}`;
    const poll = () => {
      fetch(`${API}/api/v1/public/form-info?${qs}`).then(r => r.json()).then(info => {
        const orders: DayOrder[] = info?.data?.orders ?? [];
        if (info?.data?.clientName) setDayOrders(orders);
        if (mergeTarget && mergeTarget !== 'new') {
          const target = orders.find(o => o.id === mergeTarget);
          if (!target || !target.editable) {
            setLiveWarning(
              target
                ? `Tu pedido #${target.num} ya no se puede modificar - su estado cambió a "${STATUS_LABEL_CLIENT[target.status] ?? target.status}". Contáctanos directamente si necesitas hacer un cambio.`
                : 'Este pedido ya no está disponible. Contáctanos directamente si necesitas hacer un cambio.',
            );
          }
        }
      }).catch(() => { /* transient poll failure - just try again next tick */ });
      // Catalog rarely changes mid-visit, but keeps a long-open tab (or a client who
      // walks away and comes back) from working off a stale product list if staff
      // edited it in the meantime - same reasoning as the orders poll above.
      fetch(`${API}/api/v1/public/products?${qs}`).then(r => r.json()).then(prods => {
        if (Array.isArray(prods?.data)) setProducts(prods.data);
      }).catch(() => { /* transient poll failure - just try again next tick */ });
    };
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [state, token, deviceToken, mergeTarget]);

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

  // The qty box's effective current text - whatever's actively being typed
  // (pendingQty), or else the item's own already-committed label if it's already
  // on the order, or blank for an untouched catalog row. Shared by addProduct AND
  // commitUnitChange below, so changing the unit dropdown alone (nothing newly
  // typed in the qty box) still has something to recombine with instead of
  // silently no-op'ing - that silent no-op was exactly why switching Kilo->Libra
  // on an already-added item never saved before.
  function effectiveQty(p: Product): string {
    const addedItem = selected.find(i => i.productId === p.id);
    return (pendingQty[p.id] ?? (addedItem ? addedItem.quantity_label : '')).trim();
  }

  // Commits on EVERY keystroke, not just on blur/Enter - the client form has no
  // "unsaved draft" concept the person needs to remember to close out; typing
  // "1" in a fresh row must already be a real, sendable item, even if they never
  // touch another field afterward (e.g. the very first product they type, when
  // the unit was already left at its default and never touched either). Clearing
  // the box back to empty removes the item, symmetric with the Trash button.
  function commitQtyChange(p: Product, rawValue: string) {
    setPendingQty(prev => ({ ...prev, [p.id]: rawValue }));
    const num = rawValue.trim();
    if (!num) {
      setSelected(prev => prev.filter(i => i.productId !== p.id));
      return;
    }
    const unit = pendingUnit[p.id] ?? DEFAULT_UNIT;
    const alreadyAdded = selected.some(i => i.productId === p.id);
    // Only append the unit onto an actual NUMBER ("2" -> "2 Kilo") - free-text
    // quantities ("una papa mediana", "la más gruesa que tengan") already say what
    // they mean and a unit tacked onto the end would just read wrong.
    // An item being RE-edited (already added) is the one exception: its qty box
    // was pre-filled with the FULL existing quantity_label (see effectiveQty
    // above), not a bare number - re-combining it with the unit dropdown again
    // would double up ("2 Kilo" + "Kilo" -> "2 Kilo Kilo"). Whatever's typed/shown
    // there now is already the complete final text.
    const qty = alreadyAdded ? num : (/^\d/.test(num) ? `${num} ${unit}` : num);
    setSelected(prev => {
      const exists = prev.findIndex(i => i.productId === p.id);
      if (exists >= 0) {
        return prev.map((i, idx) => idx === exists ? { ...i, quantity_label: qty } : i);
      }
      return [...prev, { product_name: p.name, quantity_label: qty, productId: p.id }];
    });
  }

  // Enter still "confirms" a row (moves focus to search) - the value's already
  // committed by commitQtyChange on every keystroke, this just clears the local
  // pending markers and returns to search, same as before.
  function addProduct(p: Product) {
    commitQtyChange(p, effectiveQty(p));
    setPendingQty(prev => { const c = { ...prev }; delete c[p.id]; return c; });
    setPendingUnit(prev => { const c = { ...prev }; delete c[p.id]; return c; });
    setSearch('');
  }

  // Fired the instant the unit dropdown changes (a <select> has no "still typing"
  // state the way a text input does, so there's no separate blur moment to wait
  // for). Pulls the leading number out of the CURRENT effective quantity and
  // recombines it with the new unit ("2 Kilo" + Libra -> "2 Libra") - a free-text
  // quantity with no leading number (or nothing typed yet) is left alone, same
  // reasoning as addProduct: the unit dropdown doesn't apply to it.
  function commitUnitChange(p: Product, newUnit: string) {
    setPendingUnit(prev => ({ ...prev, [p.id]: newUnit }));
    const current = effectiveQty(p);
    const m = current.match(/^\d+(?:[.,]\d+)?/);
    if (!m) return;
    const newQty = `${m[0]} ${newUnit}`;
    setSelected(prev => {
      const exists = prev.findIndex(i => i.productId === p.id);
      if (exists < 0) return prev; // not added yet - nothing to recombine into
      return prev.map((i, idx) => idx === exists ? { ...i, quantity_label: newQty } : i);
    });
  }

  function addManualProduct() {
    const name = manualName.trim();
    // Free text, same as the catalog rows above - no unit dropdown here either
    // (was confusing where to even type the quantity, buried next to a Kilo/
    // Libra/... picker that didn't apply to most manually-typed products anyway).
    const qty = manualQty.trim();
    if (!name || !qty) return;
    const id = `manual-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    setSelected(prev => [...prev, { product_name: name, quantity_label: qty, productId: id, isManual: true }]);
    setManualName('');
    setManualQty('');
    setManualOpen(false);
  }

  // Flat, visible-order list of catalog products - drives Up/Down navigation
  // across category boundaries (visibleGroups is grouped, this flattens it).
  const flatVisibleProducts = useMemo(
    () => visibleGroups.flatMap(g => g.products),
    [visibleGroups],
  );

  function focusCatalogQty(productId: string) {
    const el = qtyInputRefs.current[productId];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  }

  // Shared Up/Down/Left/Right handler for a catalog row's qty input or unit
  // select. Never touches pendingQty/pendingUnit - those live per-product-id, so
  // moving focus away from a row can't ever erase what's already there (it commits
  // it instead, via the qty input's own onBlur below).
  function handleCatalogKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, p: Product, field: 'qty' | 'unit') {
    if (e.key === 'Enter' && field === 'qty') { e.preventDefault(); addProduct(p); return; }
    if (e.key === 'ArrowLeft' && field === 'unit') { e.preventDefault(); qtyInputRefs.current[p.id]?.focus(); return; }
    if (e.key === 'ArrowRight' && field === 'qty') { e.preventDefault(); unitSelectRefs.current[p.id]?.focus(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = flatVisibleProducts.findIndex(fp => fp.id === p.id);
      if (idx < 0) return;
      const nextIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
      const next = flatVisibleProducts[nextIdx];
      if (!next) return;
      const refs = field === 'qty' ? qtyInputRefs : unitSelectRefs;
      const el = refs.current[next.id];
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
    }
  }

  // Selected-items summary row: Up/Down moves between rows; Right/Enter jumps to
  // that product's editable qty field back in the catalog (the "editable" field
  // the client would use to change it), per the client's own request.
  function handleSelectedRowKeyDown(e: KeyboardEvent<HTMLDivElement>, item: SelectedItem, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      focusCatalogQty(item.productId);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const list = summaryExpanded ? selected : selected.slice(0, 2);
      const nextIdx = e.key === 'ArrowUp' ? index - 1 : index + 1;
      const next = list[nextIdx];
      if (next) selectedRowRefs.current[next.productId]?.focus();
    }
  }

  function removeSelected(productId: string) {
    setSelected(prev => prev.filter(i => i.productId !== productId));
  }

  // Deletes the WHOLE order (not one item) and always lands on the "Pedido
  // eliminado correctamente" screen next - never back on a menu. Two cases:
  // - `mergeTarget` is a real order id: it already exists on the platform, so
  //   this actually calls the delete endpoint (soft-deletes to papelera,
  //   notifies staff) before leaving.
  // - `mergeTarget` is 'new' (still just a local draft, never submitted): there's
  //   nothing on the platform to delete - just clear the local draft and leave.
  async function deleteEntireOrder() {
    if (!window.confirm('¿Eliminar este pedido por completo? Esta acción no se puede deshacer.')) return;
    const isRealOrder = !!mergeTarget && mergeTarget !== 'new';
    if (!isRealOrder) {
      setSelected([]);
      setPendingQty({});
      setAddress('');
      setPaymentMethod('');
      setSummaryExpanded(false);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      setState('deleted');
      return;
    }
    setDeletingOrder(true);
    try {
      const res = await fetch(`${API}/api/v1/public/order/${mergeTarget}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, device_token: deviceToken }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        alert(err.error ?? 'No se pudo eliminar el pedido.');
        return;
      }
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      setSelected([]);
      setAddress('');
      setPaymentMethod('');
      setState('deleted');
    } catch {
      alert('No se pudo conectar. Verifica tu internet e intenta de nuevo.');
    } finally {
      setDeletingOrder(false);
    }
  }

  function clearOrder() {
    if (!window.confirm('¿Borrar todos los productos agregados? La dirección y el método de pago se mantienen.')) return;
    setSelected([]);
    setPendingQty({});
    setSummaryExpanded(false);
  }

  async function handleSubmit() {
    // Synchronous ref check - the very first tap to reach here wins and flips this
    // immediately, so a rapid double tap's second event is dropped right here, before
    // it can ever fire a second fetch. Whatever happens next (success or a real
    // error), it happens to the FIRST tap's request, never gets silently lost to a
    // race with a second one.
    if (submittingRef.current) return;
    if (selected.length === 0) { setSubmitError('Agrega al menos un producto'); return; }
    if (!address.trim()) {
      setSubmitError('Ingresa la dirección de entrega');
      setSummaryExpanded(true);
      summaryRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!hasConsent && !consentChecked) {
      setSubmitError('Debes aceptar la Política de Tratamiento de Datos para continuar');
      return;
    }
    submittingRef.current = true;
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/v1/public/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          device_token: deviceToken,
          address: address.trim(),
          payment_method: paymentMethod || undefined,
          merge_order_id: mergeTarget && mergeTarget !== 'new' ? mergeTarget : undefined,
          // Solo se manda la primera vez (mientras hasConsent sea false) - el
          // backend lo guarda una vez y no lo vuelve a pedir en un pedido posterior.
          ...(!hasConsent ? { consent: consentChecked } : {}),
          items: selected.map(i => ({ product_name: i.product_name, quantity_label: i.quantity_label, ...(i.isManual ? { is_manual: true } : {}) })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string; code?: string }));
        // Every branch below prefers the server's own explanatory `error` text when
        // present - it's already specific (e.g. "Tu pedido #12 ya está en camino y
        // no se puede modificar") - only falling back to a made-up message when the
        // server didn't send one.
        if (res.status === 429) {
          setSubmitError(
            err.code === 'FORM_LIMIT_REACHED'
              ? (err.error ?? 'Alcanzaste el límite de pedidos permitidos con este link. Contáctanos directamente para hacer otro.')
              : 'Enviaste varios pedidos muy seguido. Espera un minuto e intenta de nuevo.',
          );
          return;
        }
        if (res.status === 401) {
          setSubmitError('Este link ya no es válido - expiró, fue reemplazado por uno nuevo, o fue bloqueado. Pide un link actualizado.');
          return;
        }
        // 404 (pedido/ticket ya no existe) and 409 (pedido ya no editable - cambió de
        // estado justo cuando el cliente envió) both come with a specific, accurate
        // reason already worded for the client - show it as-is.
        setSubmitError(err.error ?? 'Hubo un problema. Intenta de nuevo.');
        return;
      }
      if (!hasConsent) setHasConsent(true); // ya quedó guardado en el ticket, no volver a pedirlo en este mismo tab
      setState('done');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch {
      setSubmitError('Hubo un problema de conexión. Intenta de nuevo.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  const GREEN = '#1A7A4A';
  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f0f4f8',
  };
  const header: React.CSSProperties = {
    background: GREEN, color: '#fff', padding: '14px 16px',
    position: 'sticky', top: 0, zIndex: 20,
    display: 'flex', alignItems: 'center', gap: 10,
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', fontSize: 17, fontWeight: 800,
    padding: '15px 0', background: GREEN, color: '#fff',
    border: 'none', borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  };
  const safetyNotice: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    background: '#EFF6FF', borderBottom: '2px solid #BFDBFE', color: '#1E3A8A',
    padding: '10px 16px', fontSize: 11.5, fontWeight: 800, lineHeight: 1.5,
  };

  if (state === 'loading') return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  if (state === 'invalid') return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><XCircle size={56} color="#DC2626" strokeWidth={1.5} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Link inválido</div>
        <div style={{ fontSize: 15, color: '#666' }}>{errorMsg}</div>
      </div>
    </div>
  );

  if (state === 'done') return (
    <div style={page}>
      <div style={header}>
        <ShoppingCart size={22} color="#fff" />
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '36px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><CheckCircle size={72} color={GREEN} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 24, fontWeight: 800, color: GREEN, marginBottom: 10 }}>¡Pedido enviado!</div>
        <div style={{ fontSize: 17, color: '#555', lineHeight: 1.6, marginBottom: 20 }}>
          Tu pedido fue enviado a <strong>{orgName}</strong>.<br />
          En breve te atenderemos por WhatsApp.
        </div>
        <button onClick={continueToForm} style={btnPrimary}>Ver mi pedido</button>
      </div>
    </div>
  );

  if (state === 'deleted') return (
    <div style={page}>
      <div style={header}>
        <ShoppingCart size={22} color="#fff" />
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '36px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={36} color="#DC2626" strokeWidth={1.5} />
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#DC2626', marginBottom: 10 }}>Pedido eliminado correctamente</div>
        <div style={{ fontSize: 15, color: '#555', lineHeight: 1.6, marginBottom: 20 }}>
          Si quieres hacer un pedido nuevo, puedes seguir usando este mismo link.
        </div>
        <button onClick={continueToForm} style={btnPrimary}>Hacer un pedido</button>
      </div>
    </div>
  );

  const selectedCount = selected.length;
  const editingOrder = mergeTarget && mergeTarget !== 'new' ? dayOrders.find(o => o.id === mergeTarget) : undefined;
  const lastOrderAvailableCount = lastOrder?.filter(i => i.available).length ?? 0;

  return (
    <div style={page}>
      <div style={header}>
        <ShoppingCart size={20} color="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{orgName}</div>
          {clientName && <div style={{ fontSize: 12, opacity: 0.85 }}>Hola, {clientName}</div>}
        </div>
        {selectedCount > 0 && (
          <div style={{ background: '#fff', color: GREEN, fontWeight: 800, fontSize: 13, padding: '4px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Check size={13} /> {selectedCount} ítem{selectedCount > 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div style={safetyNotice}>
        <Lock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.</span>
      </div>

      {editingOrder && (
        <div style={{ background: '#F0FDF4', borderBottom: '2px solid #BBF7D0', color: GREEN, padding: '8px 16px', fontSize: 12.5, fontWeight: 700 }}>
          Editando tu pedido #{editingOrder.num}
        </div>
      )}

      {liveWarning && (
        <div style={{ background: '#FEF2F2', border: '2px solid #FCA5A5', color: '#DC2626', margin: '10px 16px 0', padding: '10px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700 }}>
          {liveWarning}
        </div>
      )}

      {/* Delivery details - ALWAYS visible, even before any product is added
          (previously hidden inside the same panel as the item summary, so a client
          with zero items yet couldn't even type an address). Only the send button
          stays gated on having at least one product. */}
      <div ref={summaryRef} style={{ background: '#fff', margin: '0 0 2px', padding: '12px 16px', borderBottom: '2px solid #e0e0e0' }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 5 }}>
          Dirección de entrega <span style={{ fontWeight: 700, color: '#DC2626' }}>*</span>
        </label>
        <input
          type="text"
          placeholder="Calle, número, barrio..."
          value={address}
          onChange={e => { setAddress(e.target.value); if (submitError) setSubmitError(''); }}
          style={{ width: '100%', fontSize: 14, padding: '10px 12px', border: `2px solid ${!address.trim() && submitError ? '#DC2626' : '#ddd'}`, borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 10 }}
        />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 5 }}>
          Método de pago <span style={{ fontWeight: 400, color: '#999' }}>(opcional)</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { value: 'transfer', label: 'Transferencia' },
            { value: 'cash', label: 'En tienda' },
            { value: 'cod', label: 'Cobro en casa' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPaymentMethod(opt.value)}
              style={{
                flex: 1, padding: '9px 6px', fontSize: 12, fontWeight: 700,
                borderRadius: 10, cursor: 'pointer',
                border: `2px solid ${paymentMethod === opt.value ? GREEN : '#ddd'}`,
                background: paymentMethod === opt.value ? '#f0fdf4' : '#fff',
                color: paymentMethod === opt.value ? GREEN : '#444',
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Opt-in "repetir pedido" - only offered on a genuinely empty NEW order
            (never while editing an existing one, and never auto-applied). */}
        {selectedCount === 0 && mergeTarget === 'new' && lastOrderAvailableCount > 0 && (
          <button
            type="button"
            onClick={applyLastOrder}
            style={{
              width: '100%', marginTop: 12, padding: '12px 14px',
              background: '#f0fdf4', color: GREEN, border: `2px solid ${GREEN}`,
              borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14,
            }}>
            Repetir mi último pedido ({lastOrderAvailableCount} producto{lastOrderAvailableCount > 1 ? 's' : ''})
          </button>
        )}

        {/* Item summary - only once there's something to show, collapses past 2 */}
        {selectedCount > 0 && (
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: GREEN, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Productos {mergeTarget !== 'new' ? 'del pedido' : 'agregados'} ({selectedCount})
            </div>
            {(summaryExpanded ? selected : selected.slice(0, 2)).map((s, idx) => (
              <div key={s.productId}
                ref={el => { selectedRowRefs.current[s.productId] = el; }}
                tabIndex={0}
                onKeyDown={e => handleSelectedRowKeyDown(e, s, idx)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f0f0f0', outline: 'none' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.product_name}
                    {s.isManual && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 20, padding: '1px 7px' }}>
                        No catalogado
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{s.quantity_label}</div>
                </div>
                <button onClick={() => removeSelected(s.productId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              {selectedCount > 2 ? (
                <button onClick={() => setSummaryExpanded(e => !e)}
                  style={{ fontSize: 13, color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {summaryExpanded
                    ? <><ChevronUp size={14} /> Ver menos</>
                    : <><ChevronDown size={14} /> Ver los {selectedCount}</>}
                </button>
              ) : <span />}
              <button onClick={clearOrder}
                style={{ fontSize: 13, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Trash2 size={14} /> Quitar todos los productos
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div style={{ position: 'sticky', top: 52, zIndex: 10, background: '#f0f4f8', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 12, border: '2px solid #ddd', padding: '8px 14px', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, background: 'transparent', fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => { setSearch(''); searchRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888', lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>

        {/* "Agregar producto no listado" - a product missing from the catalog
            (out of season, a special request, etc). Sent flagged is_manual so
            staff sees it highlighted and knows to price/review it. */}
        {!manualOpen ? (
          <button onClick={() => setManualOpen(true)}
            style={{
              width: '100%', marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
              color: GREEN, fontSize: 13, fontWeight: 700, textAlign: 'center', padding: '4px 0',
            }}>
            ¿No encuentras tu producto? Agrégalo aquí
          </button>
        ) : (
          <div style={{ background: '#fff', border: '2px solid #ddd', borderRadius: 12, padding: 10, marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 6 }}>Producto no listado</div>
            <input
              type="text"
              placeholder="Nombre del producto"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              style={{ width: '100%', fontSize: 14, padding: '9px 10px', border: '2px solid #ddd', borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Cantidad (ej: 2, o 'una mediana')"
                value={manualQty}
                onChange={e => setManualQty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addManualProduct(); }}
                style={{ flex: 1, minWidth: 0, fontSize: 14, padding: '9px 10px', border: '2px solid #ddd', borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: '#111', background: '#fff' }}
              />
              <button onClick={addManualProduct} disabled={!manualName.trim() || !manualQty.trim()}
                style={{
                  padding: '9px 14px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13,
                  background: (manualName.trim() && manualQty.trim()) ? GREEN : '#ddd', color: '#fff',
                  cursor: (manualName.trim() && manualQty.trim()) ? 'pointer' : 'default',
                }}>
                Agregar
              </button>
              <button onClick={() => { setManualOpen(false); setManualName(''); setManualQty(''); }}
                style={{ padding: '9px 12px', borderRadius: 10, border: '2px solid #ddd', background: '#fff', color: '#666', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Catalog */}
      <div style={{ padding: '0 16px 120px' }}>
        {visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', padding: 32, fontSize: 16 }}>
            {search ? `Sin resultados para "${search}"` : 'Sin productos disponibles'}
          </div>
        )}

        {visibleGroups.map(group => (
          <div key={group.category} style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.7px',
              color: GREEN, padding: '10px 4px 4px', borderBottom: `2px solid ${GREEN}22`,
            }}>
              {group.category}
            </div>

            {group.products.map(p => {
              const isAdded = selected.some(i => i.productId === p.id);
              const addedItem = selected.find(i => i.productId === p.id);
              // Falls back to the item's OWN current text, not blank - previously
              // this box was always empty for an already-added item (only the
              // separate green "Agregado: X" line showed the value), so changing
              // even one character meant retyping the whole quantity from scratch
              // instead of just editing what's already there.
              const qty = pendingQty[p.id] ?? (isAdded && addedItem ? addedItem.quantity_label : '');
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 4px', borderBottom: '1px solid #eee',
                  background: isAdded ? '#f0fdf4' : 'transparent',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: isAdded ? 700 : 500, color: isAdded ? GREEN : '#111', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {p.name}
                      {isAdded && <Check size={13} color={GREEN} />}
                    </div>
                    {p.unit_type && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{p.unit_type}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <input
                      ref={el => { qtyInputRefs.current[p.id] = el; }}
                      type="text"
                      placeholder="Cant."
                      value={qty}
                      // Commits on every keystroke, not just on blur - a single
                      // "1" typed and left at the default unit must already be a
                      // real, sendable item (see commitQtyChange's own comment).
                      onChange={e => commitQtyChange(p, e.target.value)}
                      onKeyDown={e => handleCatalogKeyDown(e, p, 'qty')}
                      style={{
                        width: 92, fontSize: 15, padding: '9px 6px',
                        border: `2px solid ${qty.trim() ? GREEN : '#ddd'}`,
                        borderRadius: 10, outline: 'none', textAlign: 'center',
                        fontFamily: 'inherit', color: '#111', background: '#fff',
                      }}
                    />
                    <select
                      ref={el => { unitSelectRefs.current[p.id] = el; }}
                      value={pendingUnit[p.id] ?? DEFAULT_UNIT}
                      onChange={e => commitUnitChange(p, e.target.value)}
                      onKeyDown={e => handleCatalogKeyDown(e, p, 'unit')}
                      style={{
                        fontSize: 13, padding: '9px 4px',
                        border: `2px solid ${qty.trim() ? GREEN : '#ddd'}`,
                        borderRadius: 10, outline: 'none',
                        fontFamily: 'inherit', color: '#111', background: '#fff',
                      }}
                    >
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    {isAdded && (
                      <button
                        onClick={() => removeSelected(p.id)}
                        style={{
                          width: 38, height: 38, borderRadius: '50%', border: '2px solid #F5C6C6',
                          background: '#fff', color: '#DC2626', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}
                        title="Quitar este producto"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom bar - stays visible even with zero items (client removed everything
          from an order they'd already started) instead of vanishing along with the
          last item, which left them stuck with no visible way to submit or even see
          why. Submit just shows disabled + the same red reason instead. */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: '#fff', borderTop: '2px solid #e0e0e0',
        padding: '12px 16px',
        boxShadow: '0 -4px 16px rgba(0,0,0,.08)',
      }}>
        {selectedCount === 0 && (
          <div style={{ color: '#DC2626', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            Debe haber al menos un producto
          </div>
        )}
        {/* Ley 1581 de 2012 - solo se muestra la primera vez por ticket (ver
            hasConsent, cargado desde form-info). Un cliente que ya aceptó en un
            pedido anterior no lo vuelve a ver. */}
        {!hasConsent && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, fontSize: 12.5, color: '#444', lineHeight: 1.4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={e => { setConsentChecked(e.target.checked); if (submitError) setSubmitError(''); }}
              style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16 }}
            />
            <span>
              Leí y acepto la{' '}
              <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ color: GREEN, fontWeight: 700, textDecoration: 'underline' }}>
                Política de Tratamiento de Datos
              </a>
              {' '}de {orgName || 'este negocio'}.
            </span>
          </label>
        )}
        {submitError && <div style={{ color: '#DC2626', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{submitError}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          {selectedCount > 0 && (
            <button
              onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth' })}
              title="Ver productos agregados"
              style={{
                flex: '0 0 auto', padding: '14px 16px',
                background: '#f0f4f8', color: '#333', border: '2px solid #ddd',
                borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <Check size={14} color={GREEN} /> {selectedCount}
            </button>
          )}
          <button
            onClick={deleteEntireOrder}
            disabled={submitting || deletingOrder}
            title="Eliminar este pedido por completo"
            aria-label="Eliminar pedido"
            style={{
              flex: '0 0 auto', padding: '14px 14px',
              background: '#fff', color: '#DC2626', border: '2px solid #F5C6C6',
              borderRadius: 12, cursor: (submitting || deletingOrder) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontWeight: 700, fontSize: 13,
              opacity: (submitting || deletingOrder) ? 0.5 : 1,
            }}>
            <Trash2 size={16} /> Eliminar pedido
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !!liveWarning || selectedCount === 0}
            style={{ ...btnPrimary, flex: 1, opacity: (submitting || liveWarning || selectedCount === 0) ? 0.6 : 1 }}>
            {submitting ? 'Enviando...' : 'Enviar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
