import { Fragment, useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Banknote, AlertTriangle, CheckCircle, ChevronDown, FileText, Send, Lock, Bell, ClipboardList, Ban, Paperclip, Forward } from 'lucide-react';
import jsPDF from 'jspdf';
import { api } from '../../lib/api';
import { buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../../lib/formLinkMessage';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { useDiaCerrado } from '../../hooks/useCierre';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP, PAYMENT_LABEL, todayStr, formatChatTimestamp, formatChatDateDivider, colombiaDateStr } from '../../lib/format';
import { formatPhoneDisplay, looksFake } from '../../lib/formatPhone';
import { toast } from '../ui/Toast';
import DeliveryStatus from '../ui/DeliveryStatus';
import ChatImage from '../ui/ChatImage';
import ChatAudio from '../ui/ChatAudio';
import ChatVideo from '../ui/ChatVideo';
import ChatDocument from '../ui/ChatDocument';
import ChatLocation from '../ui/ChatLocation';
import { useSendChatMedia, CHAT_MEDIA_ACCEPT } from '../../hooks/useSendChatMedia';
import ProductSearch, { ProductSearchHandle } from '../orders/ProductSearch';
import CodPaymentField from '../orders/CodPaymentField';
import ForwardMessageModal from '../ui/ForwardMessageModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import HistoryTable from '../ui/HistoryTable';
import PasswordInput from '../ui/PasswordInput';

interface Props { orderId: string; onClose: () => void; openCobro?: boolean; }

const COD_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#0D9488', cerrado: '#1A7A4A',
};

function formatHour(raw: string | null | undefined): string {
  if (!raw) return '-';
  // order_hour is a DB TIME column (no date/timezone) stored using the server's clock
  // (UTC on Railway). Prisma serializes it as an epoch-day ISO string with a "Z" suffix,
  // so it must be converted to Colombia local time explicitly - reading getUTCHours()
  // directly (old behavior) showed the raw UTC hour, ~5h ahead of the real local time.
  const d = raw.includes('T') ? new Date(raw) : new Date(`1970-01-01T${raw}Z`);
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });
}

// order.fecha is a DATE-only column (no real time-of-day), serialized as midnight UTC
// for that calendar day. Converting that straight through a Bogota (UTC-5) timezone
// conversion — like formatDateTime does for real timestamps — reads it as 7pm the
// PREVIOUS day, which is exactly why an invoice for a past pedido was printing
// today's date if built from `new Date()`, or would print the wrong day even if built
// from the order's own fecha the naive way. Pin to noon UTC first so no timezone
// offset in practical use can push it across a day boundary either direction.
function formatFechaLong(raw: string | null | undefined): string {
  if (!raw) return '-';
  const ymd = raw.split('T')[0];
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  });
}

const URL_RE = /(https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]{1,2000})/g;
function renderText(text: string) {
  const parts = text.split(URL_RE);
  URL_RE.lastIndex = 0;
  return parts.map((p, i) => {
    URL_RE.lastIndex = 0;
    return URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer noopener"
          style={{ color: 'var(--v)', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p;
  });
}

export default function DetallePedidoModal({ orderId, onClose, openCobro }: Props) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = user?.role === 'admin';
  // encargado has the same order-management permissions as admin everywhere else in
  // the app (can cobro, move status, etc. - see requireRole('admin', 'encargado') on
  // the backend) except this modal, where a stricter admin-only isAdmin left them
  // without the papelera button and other actions admin has on the exact same order.
  const canManage = isAdmin || user?.role === 'encargado' || user?.role === 'dev';
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<{ data: any }>(`/orders/${orderId}`).then((r) => r.data),
  });

  // The order's OWN day, not whatever day the caller happened to be viewing when it
  // opened this modal - this can be opened from search/notifications too, not just
  // the board for the currently-selected date.
  const orderFecha: string | undefined = order?.fecha ? new Date(order.fecha).toISOString().split('T')[0] : undefined;
  const { data: cierreStatus } = useDiaCerrado(orderFecha);
  const diaCerrado = cierreStatus?.cerrado ?? false;

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [pago, setPago] = useState('transfer');
  // Neither selected by default - same reasoning as NuevoPedidoModal's own copy of
  // this: staff must actively pick one, not fall into a silent default.
  const [codChoice, setCodChoice] = useState<'completo' | 'vuelta' | null>(null);
  const [codCash, setCodCash] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const productSearchRef = useRef<ProductSearchHandle>(null);
  // Whole-form keyboard nav (Up/Down between field rows, Left/Right within a row)
  // - nombre -> dirección -> método de pago/domiciliario -> catalog search ->
  // productos, same direction the eye already reads the form in. Enter opening a
  // focused <select> and Esc closing it need no extra code at all - that's
  // already the browser's own default behavior for a native select; the only
  // thing missing was moving FOCUS between fields with the arrow keys, which
  // native inputs/selects don't do across different elements on their own.
  const nombreRef = useRef<HTMLInputElement>(null);
  const direccionRef = useRef<HTMLInputElement>(null);
  const pagoRef = useRef<HTMLSelectElement>(null);
  const empleadoRef = useRef<HTMLSelectElement>(null);
  function handleFormArrowKeys(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, field: 'nombre' | 'direccion' | 'pago' | 'empleado') {
    // preventDefault before moving focus - without it, ArrowUp/Down on a focused
    // but CLOSED <select> is the browser's own shortcut for "change the selected
    // option", which would fight with using those same keys to move between
    // fields instead.
    if (field === 'nombre' && e.key === 'ArrowDown') { e.preventDefault(); direccionRef.current?.focus(); return; }
    if (field === 'direccion') {
      if (e.key === 'ArrowUp') { e.preventDefault(); nombreRef.current?.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); pagoRef.current?.focus(); return; }
    }
    if (field === 'pago') {
      if (e.key === 'ArrowUp') { e.preventDefault(); direccionRef.current?.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); productSearchRef.current?.focusToggle(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); empleadoRef.current?.focus(); return; }
    }
    if (field === 'empleado') {
      if (e.key === 'ArrowUp') { e.preventDefault(); direccionRef.current?.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); productSearchRef.current?.focusToggle(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); pagoRef.current?.focus(); return; }
    }
  }
  // Continues the whole-form nav graph PAST the catalog: new-observación
  // textarea -> historial toggle (if present) -> action buttons row
  // (Papelera/Guardar/Copiar/PDF/Enviar factura), Right-chained. Fixed slots
  // (not a plain push array) so a button that isn't currently rendered (e.g.
  // "Marcar crédito pagado" only shows for admin/dev on a crédito order) just
  // leaves a hole Left/Right skip over, instead of shifting every other
  // button's index around across renders.
  const obsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const historyToggleRef = useRef<HTMLDivElement>(null);
  const actionBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function actionBtnRef(idx: number) {
    return (el: HTMLButtonElement | null) => { actionBtnRefs.current[idx] = el; };
  }
  function focusFirstActionBtn() {
    const first = actionBtnRefs.current.find((el) => !!el);
    first?.focus();
  }
  // Textarea Up/Down normally moves the cursor between lines - only intercepted
  // at the very top/bottom line (no '\n' before/after the cursor), so multi-line
  // notes still work normally for internal cursor movement.
  const saveObsBtnRef = useRef<HTMLButtonElement>(null);
  function handleObsArrowKeys(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === 'ArrowUp' && el.value.slice(0, el.selectionStart ?? 0).indexOf('\n') === -1) {
      e.preventDefault();
      productSearchRef.current?.focusManualLast();
      return;
    }
    if (e.key === 'ArrowDown' && el.value.slice(el.selectionEnd ?? el.value.length).indexOf('\n') === -1) {
      e.preventDefault();
      saveObsBtnRef.current?.focus();
    }
  }
  function handleSaveObsBtnKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowUp') { e.preventDefault(); obsTextareaRef.current?.focus(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (canManage && order?.history && order.history.length > 0) { historyToggleRef.current?.focus(); return; }
      focusFirstActionBtn();
    }
  }
  function handleHistoryToggleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') { e.preventDefault(); setShowHist((v) => !v); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); saveObsBtnRef.current?.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusFirstActionBtn(); }
  }
  function handleActionBtnKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (e.key === 'ArrowUp') {
      if (historyToggleRef.current) { historyToggleRef.current.focus(); return; }
      obsTextareaRef.current?.focus();
      return;
    }
    const refs = actionBtnRefs.current;
    const idx = refs.indexOf(e.currentTarget);
    if (idx < 0) return;
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    for (let i = idx + dir; i >= 0 && i < refs.length; i += dir) {
      if (refs[i]) { refs[i]!.focus(); return; }
    }
  }
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Observaciones - independent of the rest of the form's isDirty/Guardar flow on
  // purpose, same reasoning the old single-field observación had: must stay usable
  // even when everything else is locked (see `readOnly` below). Now a growing list
  // (one row per staff member's note) instead of one shared field.
  const [newObsText, setNewObsText] = useState('');
  const [obsExpanded, setObsExpanded] = useState(false);
  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [editObsText, setEditObsText] = useState('');
  const [catalogClearKey, setCatalogClearKey] = useState(0);
  // Which scalar fields have a local edit pending, tracked individually - a plain
  // ref (not state) since it's only ever consulted inside the hydration effect
  // below, never rendered. Fixes a real bug: the effect used to skip hydrating
  // EVERY field the instant isDirty was true for ANY reason, so a client changing
  // the payment method while staff had merely started editing the address (or vice
  // versa) left the untouched field showing stale data - "cambió el cliente"
  // showed correctly (that badge reads straight off the order, not local state)
  // right next to a dropdown that still said "Sin asignar".
  const touchedFieldsRef = useRef<Set<string>>(new Set());
  function touchField(name: string) {
    touchedFieldsRef.current.add(name);
    markDirty();
  }
  const [showHist, setShowHist] = useState(false);
  const [showCobro, setShowCobro] = useState(openCobro ?? false);
  // The client-deleted decision popup (Restaurar / Mantener eliminado) shows
  // automatically whenever this order is opened with client_deleted still set -
  // "Mantener eliminado" just dismisses it locally (no mutation - the order was
  // already flagged, there's nothing to change to keep it that way); reopening
  // the same order later shows it again, since nothing here persists "reviewed".
  const [clientDeletedDismissed, setClientDeletedDismissed] = useState(false);
  useEffect(() => { setClientDeletedDismissed(false); }, [orderId]);
  const [replyText, setReplyText] = useState('');
  const [cobroPass, setCobroPass] = useState('');
  const cobroPassRef = useRef<HTMLInputElement>(null);
  const cobroConfirmBtnRef = useRef<HTMLButtonElement>(null);
  // Split cobro across efectivo + transferencia (e.g. client pays part cash,
  // part transfer) - "esos dos deben sumar el total para poder cerrar", no
  // vuelta concept once split (each piece is paid in its exact amount).
  const [splitPayment, setSplitPayment] = useState(false);
  const [splitCash, setSplitCash] = useState('');
  const [splitTransfer, setSplitTransfer] = useState('');
  // Autofocus the password field the instant the dialog opens - the whole
  // point of wiring this dialog's keyboard nav is being able to close a pedido
  // without ever touching the mouse, starting from the moment it appears.
  useEffect(() => {
    if (showCobro) { cobroPassRef.current?.focus(); return; }
    // Reset split state on close, not just password - a stale "dividido"
    // toggle/amounts left checked from a previous cobro attempt on this same
    // order (e.g. cancelled, or blocked by cierreMissing) must not silently
    // carry over into the next attempt.
    setSplitPayment(false);
    setSplitCash('');
    setSplitTransfer('');
  }, [showCobro]);
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void; danger?: boolean; onSave?: () => void } | null>(null);
  // Separate from confirmDlg - papelera needs a free-text reason, not just a
  // yes/no confirm, and re-sending after a restore must ask again every time
  // (backend clears papelera_reason on restore, so there's nothing to prefill).
  const [papeleraReasonDlg, setPapeleraReasonDlg] = useState(false);
  const [papeleraReasonText, setPapeleraReasonText] = useState('');
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<any | null>(null);

  useEffect(() => {
    if (!order) return;
    const touched = touchedFieldsRef.current;
    // Don't stomp an in-progress edit - if the person has an unsaved local change
    // on a SPECIFIC field when a live update lands (e.g. the client added items to
    // this order from the form), the fresh data is still in the cache for whenever
    // they save/close, but pulling it into that one field right now would silently
    // discard what they were typing. Every OTHER field still hydrates normally -
    // touching one field must not freeze the rest of the form too.
    if (!touched.has('nombre')) setNombre(order.customer_name ?? '');
    // Normally never staff-editable (always safe to sync from the server) - EXCEPT
    // when it's been touched, which only happens at all when phoneEditableHere
    // (below) allowed the input to be typed into in the first place.
    if (!touched.has('telefono')) setTelefono(order.customer_phone ?? '');
    if (!touched.has('direccion')) setDireccion(order.address ?? '');
    if (!touched.has('pago')) setPago(order.payment_method ?? 'transfer');
    if (!touched.has('empleado')) setEmpleadoId(order.employee_id ?? '');
    if (!catalogDirty) {
      setItems((order.items ?? []).map((i: any) => ({
        product_name: i.product_name ?? '',
        quantity_label: i.quantity_label ?? '',
        price: String(i.price ?? ''),
        added_by_client: !!i.added_by_client,
      })));
    }
    // Read the choice straight off the order - NOT inferred by comparing
    // amount_received to the total anymore. That inference broke the one time
    // "vuelta" is typed as exactly the total (zero change owed): numerically
    // identical to "completo", so it silently flipped back on reopen. cod_choice is
    // the actual source of truth now (orders.ts's validateCodAmount requires both
    // travel together, so cod_choice is always set whenever amount_received is).
    // Tied to the 'pago' touch, not its own - they're one unit (switching payment
    // method resets both together, see the select's onChange below).
    if (!touched.has('pago')) {
      setCodChoice((order.cod_choice as 'completo' | 'vuelta' | null) ?? null);
      setCodCash(order.cod_choice === 'vuelta' && order.amount_received != null ? String(order.amount_received) : '');
    }
    // Only truly "clean" (nothing at all pending) once every field actually hydrated.
    if (touched.size === 0 && !catalogDirty) setIsDirty(false);
    // Trashed orders are opened specifically to see what happened (who sent it to
    // papelera, when) - that's in the history, so show it expanded right away
    // instead of making the person hunt for the toggle.
    if (order.status === 'papelera') setShowHist(true);
  }, [order]);


  // Live-update this open order when it changes elsewhere - most importantly, a
  // client adding items to it via the form (merge flow) while a staff member already
  // has it open. Without this, they'd only see the new items after closing and
  // reopening the modal.
  useEffect(() => {
    if (!accessToken || !orderId) return;
    const sock = getSocket(accessToken);
    const onOrderChange = (data: any) => {
      const changedId = data?.id ?? data?.orderId;
      if (changedId !== orderId) return;
      if (isDirty || catalogDirty) {
        toast('Este pedido se actualizó (el cliente agregó productos) - guarda tus cambios para no perderlos');
      }
      // While catalogDirty, the items-hydration effect above deliberately skips
      // re-deriving local `items` from the cache (so it doesn't blow away whatever
      // staff is mid-typing) - but that means a concurrent client edit landing
      // right now would otherwise be invisible to local state entirely, and a
      // save a moment later (full delete+recreate of OrderItem, orders.ts PATCH
      // /:id) would silently wipe it out along with its added_by_client red
      // highlight. Merge in any item from the fresh server data that isn't
      // already present locally (matched by product_name, the same key used
      // everywhere else items don't carry a stable id) instead of just warning
      // and hoping staff manually re-adds it after reading the toast.
      if (catalogDirty && data?.id && Array.isArray(data.items)) {
        setItems((prev: any[]) => {
          const known = new Set(prev.map((i) => i.product_name));
          const missing = data.items
            .filter((i: any) => !known.has(i.product_name))
            .map((i: any) => ({
              product_name: i.product_name ?? '',
              quantity_label: i.quantity_label ?? '',
              price: String(i.price ?? ''),
              added_by_client: true,
            }));
          return missing.length > 0 ? [...prev, ...missing] : prev;
        });
      }
      // order:updated already carries the FULL fresh order (public.ts/orders.ts emit
      // the complete row) - write it straight into the cache instead of just
      // invalidating and waiting on a redundant network refetch. That extra round
      // trip was the visible lag between a client's edit landing and this modal
      // (when not mid-edit itself) actually showing the new address/payment/items.
      if (data?.id && data?.items) {
        qc.setQueryData(['order', orderId], data);
      } else if (typeof data?.newStatus === 'string') {
        // order:moved (drag on the board, Avanzar/Retroceder) only carries
        // {orderId, newStatus} - patch just that field into the cache directly
        // instead of invalidating and waiting on a background refetch. Enviar
        // factura's re-enable reads order.status on every render, so this alone
        // is enough to flip it back the instant a revert-to-listo lands, with no
        // network round trip in between to lag behind.
        qc.setQueryData(['order', orderId], (old: any) => old ? { ...old, status: data.newStatus } : old);
      } else {
        qc.invalidateQueries({ queryKey: ['order', orderId] });
      }
    };
    sock.on('order:updated', onOrderChange);
    sock.on('order:paid', onOrderChange);
    sock.on('order:moved', onOrderChange);
    return () => {
      sock.off('order:updated', onOrderChange);
      sock.off('order:paid', onOrderChange);
      sock.off('order:moved', onOrderChange);
    };
  }, [accessToken, orderId, qc, isDirty, catalogDirty]);


  // Chat always loaded if order has ticket_id
  const { data: chatData } = useQuery({
    queryKey: ['inbox-convo', order?.ticket_id],
    queryFn: () => order?.ticket_id
      ? api.get<{ data: any }>(`/inbox/${order.ticket_id}/messages`).then((r) => r.data)
      : null,
    enabled: !!order?.ticket_id,
    // Fallback only - real-time delivery is via socket, but a missed/late socket event
    // shouldn't leave this open conversation stale for longer than this.
    refetchInterval: 30000,
  });

  // Real-time chat push via socket
  useEffect(() => {
    if (!accessToken || !order?.ticket_id) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === order.ticket_id) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', order.ticket_id] });
      }
    };
    // Delivery/read/failure updates on a message already shown here - same
    // invalidate-and-refetch as a new message, just a different trigger. Was
    // missing entirely - this chat panel only ever caught up via its own 30s poll
    // (below), same gap TicketModal/InboxPanel already had fixed.
    const onMsgStatus = (data: { ticketId: string }) => {
      if (data?.ticketId === order.ticket_id) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', order.ticket_id] });
      }
    };
    sock.on('ticket:message', onMsg);
    sock.on('ticket:message-status', onMsgStatus);
    return () => {
      sock.off('ticket:message', onMsg);
      sock.off('ticket:message-status', onMsgStatus);
    };
  }, [accessToken, order?.ticket_id, qc]);

  // Keeps the chat pinned to the bottom, not just when a new message arrives but
  // also when an already-shown row grows AFTER that (an image finishing its async
  // load, see ChatImage) - scrolling only on message-count change fired too early
  // for images, leaving the bottom of the photo cut off until manually scrolled.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInnerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outer = chatScrollRef.current;
    const inner = chatInnerRef.current;
    if (!outer || !inner) return;
    const stick = () => { outer.scrollTop = outer.scrollHeight; };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [order?.ticket_id]);

  // Takes the FINAL items array as its mutate variable rather than reading `items`
  // state directly - triggerSave (below) commits whatever's still mid-edit in the
  // Factbox table first and passes the result straight in, since that commit's own
  // state update wouldn't be visible in this closure until the NEXT render (too late,
  // this mutation is about to fire in the same tick).
  const saveMut = useMutation({
    // amount_received: "completo" sends the order's own total (no change owed),
    // "vuelta" sends whatever staff typed, not-yet-decided (or switched away from
    // cod) explicitly sends null to clear any stale value from an earlier choice -
    // see CodPaymentField/orders.ts's validateCodAmount for the matching validation.
    mutationFn: (finalItems: any[]) => {
      const finalTotal = finalItems.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
      return api.patch(`/orders/${orderId}`, {
        customer_name: nombre,
        // Only ever actually applied server-side when this order has no ticket, or
        // its ticket has no real phone (orders.ts's PATCH /:id) - harmless to always
        // send, the backend silently drops it otherwise.
        customer_phone: telefono,
        address: direccion,
        payment_method: pago,
        employee_id: empleadoId || null,
        amount_received: pago === 'cod'
          ? (codChoice === 'completo' ? finalTotal : codChoice === 'vuelta' ? (parseFloat(codCash) || 0) : null)
          : null,
        cod_choice: pago === 'cod' ? codChoice : null,
        items: finalItems.map((i, idx) => ({
          product_name: i.product_name,
          quantity_label: i.quantity_label,
          price: parseFloat(i.price) || 0,
          sort_order: idx,
          added_by_client: !!i.added_by_client,
        })),
      });
    },
    // No onClose() here on purpose - staff kept having to save, reopen the same
    // order, and keep going for a string of small edits. Saving now just refreshes
    // this modal in place with the saved data; only actually leaving (X, Escape,
    // backdrop) closes it. The one exception is the "unsaved changes" dialog's own
    // "save and exit" option below, which explicitly closes after its own save.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      touchedFieldsRef.current.clear();
      setIsDirty(false);
      setCatalogDirty(false);
      setCatalogClearKey(k => k + 1);
      toast('Cambios guardados');
    },
    onError: (e: any) => toast(e.message, true),
  });

  // Commits whatever row is still mid-edit in the Factbox table (typed but never
  // confirmed with Enter/✓) before saving - see ProductSearchHandle's own comment for
  // why saveMut can't just read `items` state directly for this.
  function triggerSave(options?: Parameters<typeof saveMut.mutate>[1]) {
    const finalItems = productSearchRef.current?.commitPendingEdit() ?? items;
    saveMut.mutate(finalItems, options);
  }

  // These two routes (not PATCH /:id) stay open even on a locked/closed order or a
  // day already cerrado - same "pedido cerrado, pasó algo" exception the old
  // single-field observación had, see orders.ts.
  const addObsMut = useMutation({
    mutationFn: (text: string) => api.post(`/orders/${orderId}/observations`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      setNewObsText('');
      toast('Observación guardada');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const editObsMut = useMutation({
    mutationFn: ({ obsId, text }: { obsId: string; text: string }) =>
      api.patch(`/orders/${orderId}/observations/${obsId}`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      setEditingObsId(null);
      toast('Observación actualizada');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const deleteObsMut = useMutation({
    mutationFn: (obsId: string) => api.delete(`/orders/${orderId}/observations/${obsId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Observación eliminada');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const moveMut = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
    },
    onError: (e: any) => toast(e.message, true),
  });

  // `reason` is mandatory server-side (orders.ts's PATCH /:id/status 400s with
  // REASON_REQUIRED without it) - collected via papeleraReasonDlg below, not a
  // plain confirm() prompt, so it can be validated (non-empty) before submitting.
  const papeleraMut = useMutation({
    mutationFn: (reason: string) => api.patch(`/orders/${orderId}/status`, { status: 'papelera', reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); toast('Pedido enviado a papelera'); onClose(); },
    onError: (e: any) => toast(e.message, true),
  });

  // Pulls a papelera order back to 'nuevo' - most relevant for one the CLIENT
  // deleted themselves via the form (see the warning banner below), but works on
  // any papelera order.
  const restoreMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Pedido restaurado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  // Settles a crédito order sometime after it already closed unpaid (POST /:id/
  // cobro deliberately leaves crédito orders paid:false - see that mutation/route's
  // own comments) - no password/amount re-entry, that already happened at cobro
  // time; this just records the money actually came in.
  const creditoPagadoMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}/credito-pagado`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Crédito marcado como pagado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  // Fixes a pedido that cierre closed via "Cerrar sin cobro" by mistake - staff
  // picked that instead of actually confirming payment, but the money DID come
  // in (e.g. domiciliario confirms after the fact). Same "no password/amount
  // re-entry" shape as creditoPagadoMut above - unlike a live cobro, the point
  // here is just correcting the record, not making a new payment decision.
  const cobroRetroactivoMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}/cobro-retroactivo`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Pedido marcado como cobrado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const invoiceMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      toast('Factura enviada al chat');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      setReplyText('');
      // This panel silently dropped WhatsApp send failures (e.g. outside Meta's 24h
      // customer-service window) - the message still saved+showed here, so staff had
      // no way to know it never reached the client. InboxPanel already surfaces this;
      // match it here.
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado, pero este negocio no tiene WhatsApp conectado', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const { pickAndSend: pickAndSendChatMedia, isPending: sendMediaPending } = useSendChatMedia(order?.ticket_id, [['inbox-convo', order?.ticket_id]]);

  async function handleChatPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await pickAndSendChatMedia(file);
  }

  const formLinkMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function sendFormLink() {
    if (!order?.ticket_id) return;
    let url: string;
    try {
      const res = await api.get<{ data: { url: string } }>(`/inbox/${order.ticket_id}/form-link`);
      url = res.data.url;
    } catch {
      toast('No se pudo generar el link', true);
      return;
    }
    try {
      // Three separate messages, in order (awaited, not fire-and-forget - the
      // whole point is each arrives in this exact sequence, see formLinkMessage.ts).
      await formLinkMut.mutateAsync(buildFormLinkWarningMessage());
      await formLinkMut.mutateAsync(url);
      await formLinkMut.mutateAsync(buildFormLinkFollowUpMessage());
      toast('Formulario enviado');
    } catch {
      // formLinkMut's own onError already toasted the specific reason.
    }
  }

  const blockLinkMut = useMutation({
    mutationFn: () => api.post(`/inbox/${order?.ticket_id}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });

  function markDirty() { setIsDirty(true); }

  // Fixed page WIDTH (thermal-receipt-style, 80mm), but the page HEIGHT below is
  // just the size of the first sheet - newPage() below adds more identically-sized
  // pages as needed, so a long order is never silently clipped past this number.
  const PDF_PAGE_W = 80;
  const PDF_PAGE_H = 200;
  const PDF_BOTTOM_MARGIN = 12;
  const PDF_NAME_X = 3;
  const PDF_NAME_W = 30;
  const PDF_QTY_X = 48;
  const PDF_QTY_W = 16;
  const PDF_PRICE_X = 77;

  function buildPDFDoc(): jsPDF | null {
    if (!order) return null;
    const invoiceTotal = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const doc = new jsPDF({ unit: 'mm', format: [PDF_PAGE_W, PDF_PAGE_H] });
    doc.setFont('helvetica');
    let y = 10;

    // Starts a fresh page of the same size and redraws the column header, so a
    // continuation page still reads like a table instead of a bare list. Returns
    // the y position right below that header, ready to keep drawing rows.
    function newItemsPage(): number {
      doc.addPage([PDF_PAGE_W, PDF_PAGE_H]);
      let ny = 10;
      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('Producto (cont.)', PDF_NAME_X, ny);
      doc.text('Cant.', PDF_QTY_X, ny, { align: 'center' });
      doc.text('Precio', PDF_PRICE_X, ny, { align: 'right' });
      ny += 4;
      doc.line(3, ny, 77, ny); ny += 4;
      doc.setFont('helvetica', 'normal');
      return ny;
    }

    // Ensures `needed` mm of vertical space is available below `atY` before the
    // caller draws into it - starts a new page first (via `onNewPage`) if it isn't,
    // instead of letting jsPDF silently draw past the bottom edge of the sheet
    // (invisible, never rendered) the way a fixed single page used to.
    function ensureSpace(atY: number, needed: number, onNewPage: () => number): number {
      if (atY + needed <= PDF_PAGE_H - PDF_BOTTOM_MARGIN) return atY;
      return onNewPage();
    }

    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(user?.orgName ?? '4Client', 40, y, { align: 'center' }); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Pedido #${order.num}`, 40, y, { align: 'center' }); y += 5;
    doc.text(formatFechaLong(order.fecha), 40, y, { align: 'center' }); y += 5;
    doc.line(3, y, 77, y); y += 5;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold'); doc.text('Cliente:', 3, y);
    doc.setFont('helvetica', 'normal');
    const cLines = doc.splitTextToSize(order.customer_name, 52);
    doc.text(cLines, 22, y); y += cLines.length * 4 + 1;

    doc.setFont('helvetica', 'bold'); doc.text('Dirección:', 3, y);
    doc.setFont('helvetica', 'normal');
    const aLines = doc.splitTextToSize(order.address, 50);
    doc.text(aLines, 24, y); y += aLines.length * 4 + 1;

    if (order.customer_phone) {
      doc.setFont('helvetica', 'bold'); doc.text('Tel:', 3, y);
      doc.setFont('helvetica', 'normal'); doc.text(formatPhoneDisplay(order.customer_phone), 15, y); y += 5;
    }

    doc.line(3, y, 77, y); y += 5;
    // Column table - Producto | Cantidad | Precio, each value aligned under its own
    // header instead of one concatenated line, so a printed copy reads like a real
    // invoice/receipt rather than a run-on list.
    doc.setFont('helvetica', 'bold');
    doc.text('Producto', PDF_NAME_X, y);
    doc.text('Cant.', PDF_QTY_X, y, { align: 'center' });
    doc.text('Precio', PDF_PRICE_X, y, { align: 'right' });
    y += 4;
    doc.line(3, y, 77, y); y += 4;
    doc.setFont('helvetica', 'normal');

    items.forEach((i) => {
      const price = parseFloat(i.price) || 0;
      const priceStr = `$${price.toLocaleString('es-CO')}`;
      const nameLines = doc.splitTextToSize(i.product_name, PDF_NAME_W);
      // Quantity now wraps too (a long typed value, e.g. "1 bien amduro" instead of
      // a short "2 kg", used to be drawn unclamped and could visually run into the
      // product name or price columns) - row height is whichever column ends up
      // tallest, not just the name's.
      const qtyLines = doc.splitTextToSize(i.quantity_label || '-', PDF_QTY_W);
      const rowLines = Math.max(nameLines.length, qtyLines.length);
      const rowHeight = rowLines * 4 + 1.5;
      y = ensureSpace(y, rowHeight, newItemsPage);
      doc.text(nameLines, PDF_NAME_X, y);
      doc.text(qtyLines, PDF_QTY_X, y, { align: 'center' });
      doc.text(priceStr, PDF_PRICE_X, y, { align: 'right' });
      y += rowHeight;
    });

    // Total/pago/footer block always kept together on one page - estimated at a
    // fixed ~23mm (2 dividing lines + 3 text lines' worth of spacing, see the
    // increments below), so it never gets split with the total on one page and the
    // "gracias" footer alone on the next.
    y = ensureSpace(y, 23, newItemsPage);
    y += 2; doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Total:', 3, y);
    doc.text(`$${invoiceTotal.toLocaleString('es-CO')}`, 77, y, { align: 'right' }); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Pago: ${PAYMENT_LABEL[pago] ?? pago}`, 3, y); y += 5;
    doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(8); doc.text('Gracias por su compra!', 40, y, { align: 'center' });

    return doc;
  }

  function generatePDF(): void {
    const doc = buildPDFDoc();
    if (!doc || !order) return;
    // doc.save() always forces a browser download with no way to opt out - open it in
    // a new tab instead so the browser's own PDF viewer shows it; downloading from
    // there, if wanted, stays a deliberate action the person takes themselves.
    window.open(doc.output('bloburl'), '_blank');
  }

  async function sendInvoiceToChat() {
    if (!order?.ticket_id) { toast('Este pedido no tiene chat asociado', true); return; }
    const doc = buildPDFDoc();
    if (!doc || !order) return;
    try {
      const base64 = doc.output('datauristring').split(',')[1];
      const res = await api.post<{ url: string }>('/files/invoice', { data: base64, num: order.num, order_id: order.id });
      const url = res.url;
      const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
      const orgName = user?.orgName ?? '4Client';
      const msg = `Factura Pedido #${order.num} - ${orgName}\nFecha: ${formatFechaLong(order.fecha)}\nCliente: ${order.customer_name}\nTotal: $${total.toLocaleString('es-CO')}\nVisualiza tu factura: ${url}`;
      invoiceMut.mutate(msg);
    } catch {
      toast('Error al subir la factura', true);
    }
  }

  function copyInvoice() {
    if (!order) return;
    const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const lines = [
      `Pedido #${order.num} - ${user?.orgName ?? '4Client'}`,
      `Fecha: ${formatFechaLong(order.fecha)}`,
      `Cliente: ${order.customer_name}`,
      ...(order.customer_phone ? [`Teléfono: ${formatPhoneDisplay(order.customer_phone)}`] : []),
      `Dirección: ${order.address}`,
      `Método de pago: ${PAYMENT_LABEL[pago] ?? pago}`,
      '',
    ];
    items.forEach(i => lines.push(`• ${i.product_name}${i.quantity_label ? ' - ' + i.quantity_label : ''}: $${(parseFloat(i.price)||0).toLocaleString('es-CO')}`));
    lines.push('', `Total: $${total.toLocaleString('es-CO')}`);
    navigator.clipboard.writeText(lines.join('\n'));
    toast('Copiado al portapapeles');
  }

  const cobroMut = useMutation({
    mutationFn: (amountReceived: number) => api.post(`/orders/${orderId}/cobro`, {
      amount_received: amountReceived,
      password: cobroPass,
      ...(splitPayment ? { split: { cash: splitCashNum, transfer: splitTransferNum } } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Pago confirmado');
      setShowCobro(false);
      onClose();
    },
    onError: (e: any) => toast(e.message, true),
  });

  function handleChatKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const txt = replyText.trim();
      if (txt && !replyMut.isPending) replyMut.mutate(txt);
    }
  }

  // An unsent new-observation draft, or an observation mid-edit, counts as an
  // unsaved change too now - closing over either used to silently discard it,
  // same gap the regular fields already had before isDirty/catalogDirty existed.
  function hasUnsavedObs() {
    return !!newObsText.trim() || editingObsId !== null;
  }

  // Saves whatever's actually pending - an observation (add or edit) first since
  // it's independent of the rest of the form, then the regular fields if those are
  // dirty too, only closing once everything that needed saving actually saved.
  async function saveAllAndClose() {
    if (editingObsId) {
      await editObsMut.mutateAsync({ obsId: editingObsId, text: editObsText.trim() });
    } else if (newObsText.trim()) {
      await addObsMut.mutateAsync(newObsText.trim());
    }
    if (isDirty || catalogDirty) {
      // Same check the main Guardar button enforces (it's the only other place
      // triggerSave gets called) - this path must not be able to silently save
      // something the button itself would refuse to. Completo/vuelta is NOT
      // checked here on purpose - that's only required to cerrar, not to guardar.
      if (hasNegativePrice) { toast('Hay un precio negativo - corrígelo antes de guardar', true); return; }
      triggerSave({ onSuccess: () => { setConfirmDlg(null); onClose(); } });
    } else {
      setConfirmDlg(null);
      onClose();
    }
  }

  function handleClose() {
    if (isDirty || catalogDirty || hasUnsavedObs()) {
      setConfirmDlg({
        msg: 'Hay cambios sin guardar.',
        onOk: onClose,
        // Unlike a plain "Guardar cambios" click, this save came from trying to
        // CLOSE the modal - so unlike saveMut's own onSuccess (which deliberately
        // no longer closes), finishing this one should actually close it.
        onSave: saveAllAndClose,
      });
      return;
    }
    onClose();
  }

  if (isLoading || !order) return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="mwin"><div className="mbody" style={{ textAlign: 'center', color: 'var(--gt)' }}>Cargando...</div></div>
    </div>
  );

  // Old num from the most recent "pasado_manana:DATE:OLDNUM" marker (see
  // cierre.ts/Swimlane.tsx) - shown next to the current num so staff can still
  // recognize/find a pedido by the number it had before cierre renumbered it.
  // Only the LAST hop matters here (this modal always shows the order's real,
  // current fecha, never a past "ghost" day the way Swimlane's board view can).
  const deferredMarkersModal = [...(order.notes?.matchAll(/pasado_manana:(\d{4}-\d{2}-\d{2})(?::(\d+))?/g) ?? [])]
    .map((m: RegExpMatchArray) => m[2] ?? null);
  const oldNumToShow = deferredMarkersModal.length > 0 ? deferredMarkersModal[deferredMarkersModal.length - 1] : null;

  const locked = order.locked;
  // 'dev' bypasses every requireRole check on the backend (middleware/auth.ts) - has
  // to count the same way here, or a dev user would see fields as editable that the
  // backend then rejects. Deliberately NOT the same as the narrower `isAdmin` above
  // (which excludes dev, only for the papelera-button distinction elsewhere in this
  // modal) - this one specifically mirrors the backend's own admin-or-dev check.
  const canEditLocked = user?.role === 'admin' || user?.role === 'dev';
  // Frozen because its day was closed (regardless of this specific order's own
  // `locked` flag - even an order left "dejar_activo" at cierre time stops being
  // editable once that day is history) vs. frozen because it was individually paid
  // and closed - same read-only effect, different reason, so the "already
  // paid/closed" info banner below stays tied to `locked` alone, not `readOnly`.
  // A papelera order is also frozen - opened from the Papelera tab purely to see what
  // happened to it (who trashed it, when, with what items/prices), not to edit or
  // move it. It isn't necessarily `locked` (papelera never sets that flag) or on a
  // closed day, so without this it'd otherwise still show live "Mover pedido"/
  // "Guardar" controls on something that's already been thrown out.
  // `locked` alone no longer means read-only - admin/dev can still fully edit a
  // locked order (orders.ts's PATCH /:id allows it), just not once the day itself
  // is cerrado (diaCerrado still freezes everyone, admin included).
  // A crédito order follows the exact same closed-order rule as every other
  // payment method, by explicit design decision - once cobro sets locked:true,
  // only admin/dev can modify it, full stop. encargado keeps full control up
  // through creating/moving/editing/closing (cobro) the order - closing it is
  // itself an encargado-allowed action (orders.ts's POST /:id/cobro) - but once
  // closed, the only encargado-facing surface is the read-only view, same as
  // any other closed order. (An earlier version of this code exempted an unpaid
  // crédito order from this rule - reverted per explicit instruction: "una vez
  // cerrado en board solo el admin puede modificar ese y cualquier otro pedido
  // cerrado", i.e. no special case for crédito.)
  const readOnly = (locked && !canEditLocked) || diaCerrado || order.status === 'papelera' || order.client_deleted;
  // Same reasoning as TicketModal - the link itself already expires by end of the
  // Colombia day it was sent, so sending/blocking one from a past-day order's chat
  // is always acting on an already-dead link. Also true the moment TODAY's caja
  // gets closed early (cierre.ts only allows closing today, so a closed diaCerrado
  // here always means "today, already closed" - not some future/past mismatch).
  const isPastDay = (!!orderFecha && orderFecha < todayStr()) || diaCerrado;
  const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
  // Same signal items already give per-row via added_by_client - the
  // client_modified bell says "something changed" but not WHERE. Comes straight
  // off the order (orders.ts's clientChangedFlags) rather than being derived from
  // `order.history` here - that full audit trail is admin/dev only, but encargado
  // (who actually runs day-to-day fulfillment) still needs this specific signal.
  const direccionFromClient = !!order?.address_changed_by_client;
  const pagoFromClient = !!order?.payment_changed_by_client;
  // A pedido can't be closed with any of these missing - mirrors the same check enforced
  // server-side in POST /orders/:id/cobro, so the UI blocks it before the request even goes out.
  const cierreMissing: string[] = [];
  if (!nombre.trim()) cierreMissing.push('nombre');
  if (!telefono.trim()) cierreMissing.push('teléfono');
  if (!direccion.trim() || direccion.trim().toLowerCase() === 'pendiente de confirmar') cierreMissing.push('dirección');
  if (!pago || pago === 'sin_asignar') cierreMissing.push('método de pago');
  if (!empleadoId) cierreMissing.push('domiciliario');
  if (items.length === 0) cierreMissing.push('productos');
  // $0 is a legitimate, final price (item agotado) - never treated as "still needs
  // pricing". Negative is a different, actively-wrong case, handled separately below.
  // A negative price is an actively wrong value that would show up as a
  // negative line in the PDF/factura and drag the whole total down. Blocks every
  // action that reads `items` (Guardar, Copiar, PDF, Enviar factura, Papelera), not
  // just the final cobro - the server already rejects it (orderItemSchema's
  // price: z.number().min(0)) but that's a save that already failed after the fact,
  // this stops it from ever being actionable in the first place.
  const negativePriceItems = items.filter((i: any) => parseFloat(i.price) < 0);
  const hasNegativePrice = negativePriceItems.length > 0;
  const codCashNum = parseFloat(codCash) || 0;
  const codValid = pago !== 'cod' || codChoice === 'completo' || (codChoice === 'vuelta' && codCashNum >= 0 && codCashNum >= total);
  if (pago === 'cod' && !codValid) cierreMissing.push('monto de pago en efectivo (completo o con vuelta)');
  // The COBRO dialog no longer asks "¿cuánto se recibió?" as a separate typed
  // field - that duplicated what cod_choice/codCash (or, for any non-cod method,
  // simply the total - there's no "change" concept on a transfer) already decided.
  // Derived here instead of re-entered, so it's always correct by construction.
  const recibido = pago === 'cod'
    ? (codChoice === 'completo' ? total : codCashNum)
    : total;
  const splitCashNum = parseFloat(splitCash) || 0;
  const splitTransferNum = parseFloat(splitTransfer) || 0;
  // Exact match required (not >=) - a split cobro has no vuelta concept, the
  // two pieces together must land exactly on the total.
  const splitValid = !splitPayment || (splitCashNum + splitTransferNum === total);
  const cobroValido = cierreMissing.length === 0 && cobroPass.trim().length > 0 && splitValid;
  const hasChatPanel = !!order.ticket_id;

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      {/* Split layout: LEFT=chat, RIGHT=order (only when ticket exists) */}
      <div style={{
        display: 'flex', flexDirection: 'row',
        width: '100%', maxWidth: hasChatPanel ? 1060 : 700,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)', animation: 'mup .2s ease',
        maxHeight: '90vh',
      }}>

        {/* ===== LEFT: CHAT PANEL ===== */}
        {hasChatPanel && (
          <div style={{
            width: 300, background: '#ECE5DD', display: 'flex',
            flexDirection: 'column', flexShrink: 0, minHeight: 0,
          }}>
            {/* Chat header */}
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '12px 14px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {order.customer_name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{formatPhoneDisplay(order.customer_phone)}</div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este pedido es de un día anterior o su caja ya cerró - el link ya expiró' : 'Enviar formulario de pedido al cliente'}
                  onClick={sendFormLink}
                  disabled={formLinkMut.isPending || isPastDay}
                >
                  <ClipboardList size={13} />
                  Formulario
                </button>
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este pedido es de un día anterior o su caja ya cerró - el link ya expiró' : 'Bloquear el link de formulario enviado a este cliente'}
                  onClick={() => setConfirmDlg({
                    msg: 'Vas a bloquear el link del formulario - el cliente no podrá usarlo y tendrás que enviarle uno nuevo. ¿Deseas bloquearlo?',
                    onOk: () => blockLinkMut.mutate(),
                    danger: true,
                  })}
                  disabled={blockLinkMut.isPending || isPastDay}
                >
                  <Ban size={13} />
                  <span>Bloquear<br />Link</span>
                </button>
              </div>
            </div>

            {chatData?.no_wpp_number && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 0, padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <AlertTriangle size={14} /> Este ticket llegó sin número de WhatsApp - no se puede responder.
              </div>
            )}

            {/* Messages */}
            <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 6px' }}>
             <div ref={chatInnerRef} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {!chatData && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Cargando chat...</div>
              )}
              {chatData?.messages?.map((msg: any, i: number, arr: any[]) => {
                const isOut = msg.direction === 'out';
                const day = colombiaDateStr(msg.created_at ?? msg.sent_at);
                const prevDay = i > 0 ? colombiaDateStr(arr[i - 1].created_at ?? arr[i - 1].sent_at) : null;
                const showDivider = day !== prevDay;
                return (
                  <Fragment key={msg.id ?? i}>
                  {showDivider && (
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
                      <span style={{ background: '#e9edef', color: '#54656f', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8 }}>
                        {formatChatDateDivider(msg.created_at ?? msg.sent_at)}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      position: 'relative',
                      background: isOut ? '#DCF8C6' : '#fff',
                      borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      padding: '7px 10px', maxWidth: '85%', fontSize: 12,
                      boxShadow: '0 1px 2px rgba(0,0,0,.1)',
                    }}
                      onMouseEnter={() => setHoveredMsgId(msg.id)}
                      onMouseLeave={() => setHoveredMsgId((id) => (id === msg.id ? null : id))}>
                      {isOut && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--vd)', marginBottom: 2 }}>{msg.sender?.name ?? 'Sistema'}</div>
                      )}
                      {msg.media_type === 'image' && <ChatImage token={msg.media_url} caption={msg.media_caption ?? msg.text} />}
                      {msg.media_type === 'audio' && <ChatAudio token={msg.media_url} />}
                      {msg.media_type === 'video' && <ChatVideo token={msg.media_url} caption={msg.media_caption ?? msg.text} />}
                      {msg.media_type === 'document' && <ChatDocument token={msg.media_url} filename={msg.media_caption} caption={msg.media_caption ? msg.text : null} />}
                      {msg.media_type === 'location' && <ChatLocation url={msg.media_url} label={msg.text} />}
                      {!msg.media_type && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(msg.text)}</div>}
                      <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {formatChatTimestamp(msg.sent_at)}
                        {isOut && msg.wpp_message_id && (
                          <DeliveryStatus delivered={msg.delivered} read_by_client={msg.read_by_client} failed_reason={msg.failed_reason} />
                        )}
                      </div>
                      {hoveredMsgId === msg.id && (
                        <button
                          title="Reenviar a otro chat"
                          onClick={() => setForwardMsg(msg)}
                          style={{
                            position: 'absolute', top: -10, [isOut ? 'left' : 'right']: -10,
                            width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--brd)',
                            background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gt)', padding: 0,
                          }}>
                          <Forward size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  </Fragment>
                );
              })}
              {chatData && (!chatData.messages || chatData.messages.length === 0) && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Sin mensajes</div>
              )}
             </div>
            </div>

            {/* Reply bar - visible to all roles */}
            <div style={{
              display: 'flex', gap: 6, padding: '8px 8px',
              borderTop: '1px solid rgba(0,0,0,.1)', background: '#F0F0F0', flexShrink: 0,
            }}>
              <input ref={chatFileInputRef} type="file" accept={CHAT_MEDIA_ACCEPT} onChange={handleChatPickImage} style={{ display: 'none' }} />
              <button
                title="Adjuntar foto, audio, video o documento"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={sendMediaPending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <Paperclip size={16} />
              </button>
              <textarea
                placeholder="Responder... (Enter envía)"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleChatKeyDown}
                rows={3}
                style={{
                  flex: 1, border: '1.5px solid var(--brd)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 13, resize: 'none', fontFamily: 'inherit',
                  background: '#fff', lineHeight: 1.4,
                }}
              />
              <button
                onClick={() => { const txt = replyText.trim(); if (txt) replyMut.mutate(txt); }}
                disabled={!replyText.trim() || replyMut.isPending}
                style={{
                  background: 'var(--v)', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '0 10px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', fontSize: 12, flexShrink: 0,
                }}>
                <Send size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ===== RIGHT: ORDER DETAIL ===== */}
        <div className="mwin" style={{
          margin: 0, flex: 1, minWidth: 0,
          borderRadius: hasChatPanel ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
          boxShadow: 'none', maxHeight: '90vh',
        }}>
          <div className="mhead">
            <div>
              <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Pedido #{order.num}
                {oldNumToShow && (
                  <span style={{ fontSize: '0.7em', fontWeight: 600, color: 'var(--gt)' }}>
                    (#{oldNumToShow})
                  </span>
                )}
                {order.client_modified && (
                  <span title="El cliente modificó este pedido desde el formulario - revisa los cambios (en rojo). Este aviso queda permanente, no se quita al guardar."
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: '#DC2626' }}>
                    <Bell size={12} color="#fff" fill="#fff" />
                  </span>
                )}
                {isDirty && !readOnly && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--a)' }}>● cambios sin guardar</span>
                )}
              </div>
              <div className="msub">
                {order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}
                {order.order_hour && (
                  <span style={{ marginLeft: 6, color: 'var(--gt)', fontWeight: 600 }}>
                    · {formatHour(order.order_hour)}
                  </span>
                )}
              </div>
            </div>
            <button className="mclose" onClick={handleClose}>×</button>
          </div>

          <div className="mbody">
            {/* Info summary */}
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: 'max-content 1fr max-content 1fr', gap: '6px 12px', fontSize: 13, alignItems: 'center' }}>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Hora:</span><strong>{formatHour(order.order_hour)}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Estado:</span><strong>{STATUS_LABEL[order.status] ?? order.status}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Canal:</span><strong>{order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Pago:</span><strong style={{ color: order.paid ? 'var(--v)' : '#DC2626' }}>{order.paid ? 'Pagado' : 'Pendiente'}</strong>
            </div>

            {/* Cobro closure info (visible to all roles) */}
            {locked && (
              <div style={{ background: '#DCFCE7', border: '1.5px solid var(--vm)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                <div style={{ fontWeight: 800, color: 'var(--vd)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={15} color="var(--v)" /> Pedido cerrado y cobrado
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px' }}>
                  <div><span style={{ color: 'var(--gt)' }}>Cerrado por: </span><strong>{(order as any).paidBy?.name ?? 'Desconocido'}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Hora cierre: </span><strong>{formatDateTime(order.paid_at)}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Total: </span><strong>{fmtCOP(total)}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Recibido: </span><strong>{fmtCOP(Number(order.amount_received ?? 0))}</strong></div>
                  {canManage && (
                    <div><span style={{ color: 'var(--gt)' }}>Vuelto: </span><strong>{fmtCOP(Number(order.change_amount ?? 0))}</strong></div>
                  )}
                </div>
              </div>
            )}

            {/* Purely informational - a client can freely have more than one crédito
                order at once, paid or not (admin's own call), this never blocks
                editing/closing THIS order. Only flags OTHER orders on this same
                ticket, not this one itself - if you're already looking at the
                unpaid crédito order, you don't need to be told about it. */}
            {chatData?.orders?.some((o: any) => o.payment_method === 'credito' && !o.paid && o.id !== order.id) && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={15} /> Este cliente tiene un pedido a crédito no pagado.
              </div>
            )}

            {order.client_deleted && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--r)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={15} /> El cliente eliminó este pedido desde el formulario.
                </span>
                {canManage && (
                  <button className="bverde" onClick={() => restoreMut.mutate()} disabled={restoreMut.isPending}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCircle size={13} /> {restoreMut.isPending ? 'Restaurando...' : 'Restaurar pedido'}
                  </button>
                )}
              </div>
            )}

            {/* Same box language as "Pedido cerrado y cobrado" above (header +
                grid of fields) instead of a cramped single red line - the motivo
                itself also lives as a normal, editable/eliminable observation
                further down (Observaciones), this is just the at-a-glance summary. */}
            {order.status === 'papelera' && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={15} /> Enviado a papelera
                  </div>
                  {canManage && (
                    <button className="bverde" onClick={() => restoreMut.mutate()} disabled={restoreMut.isPending}
                      style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CheckCircle size={13} /> {restoreMut.isPending ? 'Restaurando...' : 'Restaurar pedido'}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px' }}>
                  <div><span style={{ color: 'var(--gt)' }}>Por: </span><strong>{(order as any).papeleraBy?.name ?? 'Desconocido'}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Hora: </span><strong>{formatDateTime(order.updated_at)}</strong></div>
                  {(order as any).papelera_reason && (
                    <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--gt)' }}>Motivo: </span><strong>{(order as any).papelera_reason}</strong></div>
                  )}
                </div>
              </div>
            )}

            {!locked && diaCerrado && (
              <div style={{ background: 'var(--gm)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13, color: 'var(--gt)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} /> Este día ya fue cerrado - vista de solo lectura.
              </div>
            )}

            {locked && !canEditLocked && (
              <div style={{ background: 'var(--gm)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13, color: 'var(--gt)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} /> Solo el administrador puede modificar este pedido cerrado. Puedes agregar una observación abajo.
              </div>
            )}


            {/* Also gated on !locked explicitly, not just !readOnly - admin/dev can now
                have readOnly=false on a locked order (full content edit via PATCH
                /:id), but PATCH /:id/status (what this section and Papelera below
                both call) was NOT given that same exception and still unconditionally
                rejects a locked order for every role. Showing these here would just
                be a button that always errors. */}
            {!readOnly && !locked && (
              <>
                <div className="stit">Mover pedido</div>
                <div className="movbtns">
                  {STATUS_ORDER.filter((s) => s !== 'cerrado').map((s) => (
                    <button key={s} className={`mbtn${order.status === s ? ' cur' : ''}`}
                      disabled={order.status === s || moveMut.isPending}
                      onClick={() => moveMut.mutate(s)}
                      style={{ borderLeftColor: COD_COLORS[s] }}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="stit">Información del pedido</div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Nombre del cliente</label>
                <input ref={nombreRef} className="fi2" disabled={readOnly} value={nombre}
                  onChange={(e) => { setNombre(e.target.value); touchField('nombre'); }}
                  onKeyDown={(e) => handleFormArrowKeys(e, 'nombre')} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                {/* Disabled by default - this mirrors the ticket's real WhatsApp number
                    and the backend rejects changes to it in that case (orders.ts's
                    PATCH /:id). EXCEPTION: a ticket with no real phone at all (BSUID/
                    WhatsApp usernames, or the no-hex "arrived with nothing" glitch,
                    per chatData.no_wpp_number/phone) or an order with no ticket at all
                    (channel 'call') - there IS no real number to protect, so staff can
                    type one in manually if they get it another way. Stays unlocked
                    permanently for this order (derived from the ticket's own identity,
                    not from whatever's currently typed), and every change is logged to
                    Historial via orders.ts's generic field-diff (customer_phone is now
                    tracked there). */}
                {(() => {
                  const phoneEditableHere = !readOnly && (!order.ticket_id || !!chatData?.no_wpp_number || looksFake(chatData?.phone));
                  return (
                    <input className="fi2" disabled={!phoneEditableHere}
                      value={phoneEditableHere && looksFake(telefono) ? '' : formatPhoneDisplay(telefono)}
                      placeholder={phoneEditableHere ? 'Sin teléfono - agrégalo aquí' : undefined}
                      onChange={phoneEditableHere ? (e) => { setTelefono(e.target.value); touchField('telefono'); } : undefined}
                      title={phoneEditableHere
                        ? 'Este cliente no tiene un número real registrado - puedes agregarlo manualmente'
                        : 'El teléfono no se puede modificar - es el número de WhatsApp del ticket'} />
                  );
                })()}
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">
                Dirección
                {direccionFromClient && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cambió el cliente</span>}
              </label>
              <input ref={direccionRef} className="fi2" disabled={readOnly} value={direccion}
                onChange={(e) => { setDireccion(e.target.value); touchField('direccion'); }}
                onKeyDown={(e) => handleFormArrowKeys(e, 'direccion')} />
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">
                  Método de pago
                  {pagoFromClient && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cambió el cliente</span>}
                </label>
                <select ref={pagoRef} className="fi2" disabled={readOnly} value={pago}
                  onChange={(e) => {
                    setPago(e.target.value);
                    // Same reset as NuevoPedidoModal - switching away from (or back
                    // to) 'cod' must not resurrect a stale choice/amount.
                    setCodChoice(null); setCodCash('');
                    touchField('pago');
                  }}
                  onKeyDown={(e) => handleFormArrowKeys(e, 'pago')}>
                  <option value="sin_asignar">Sin asignar</option>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Pagado en tienda</option>
                  <option value="cod">Cobro en casa</option>
                  <option value="credito">Crédito</option>
                </select>
              </div>
              <div className="fg2">
                <label className="fl2">Domiciliario</label>
                <select ref={empleadoRef} className="fi2" disabled={readOnly} value={empleadoId}
                  onChange={(e) => { setEmpleadoId(e.target.value); touchField('empleado'); }}
                  onKeyDown={(e) => handleFormArrowKeys(e, 'empleado')}>
                  <option value="">Sin asignar</option>
                  {employees.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {pago === 'cod' && (
              <CodPaymentField total={total} choice={codChoice} disabled={readOnly}
                onChoiceChange={(c) => { setCodChoice(c); touchField('pago'); }}
                cash={codCash} onCashChange={(v) => { setCodCash(v); touchField('pago'); }} />
            )}

            <div className="stit">Productos</div>
            <ProductSearch
              ref={productSearchRef}
              products={products}
              items={items}
              locked={readOnly}
              onChange={(it) => { setItems(it); markDirty(); }}
              onLocalDirty={setCatalogDirty}
              clearKey={catalogClearKey}
              onArrowUpFromSearch={() => pagoRef.current?.focus()}
              onArrowDownFromManual={() => obsTextareaRef.current?.focus()}
            />

            {/* Observaciones - a growing list of notes, always addable/editable
                regardless of locked/día cerrado (orders.ts's observation routes
                carve out the same exception the old single-field observación used
                to have). Only the author of a given note can edit it; anyone with
                access to this modal can add a new one below whatever's already
                there. Collapses to just the most recent once there are 2+. */}
            <div className="stit">Observaciones</div>
            {order.observations && order.observations.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {(order.observations.length > 1 && !obsExpanded
                  ? order.observations.slice(-1)
                  : order.observations
                ).map((obs: any) => {
                  const isAuthor = obs.author_id === user?.userId;
                  const isEditingThis = editingObsId === obs.id;
                  return (
                    <div key={obs.id} style={{ background: 'var(--gm)', borderRadius: 'var(--rad)', padding: '10px 12px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--gt)' }}>{obs.author?.name ?? 'Desconocido'}</span>
                        {isAuthor && !isEditingThis && (
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => { setEditingObsId(obs.id); setEditObsText(obs.text); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v)', fontSize: 12, fontWeight: 700 }}>
                              Editar
                            </button>
                            <button
                              onClick={() => setConfirmDlg({ msg: '¿Eliminar esta observación?', onOk: () => deleteObsMut.mutate(obs.id), danger: true })}
                              disabled={deleteObsMut.isPending}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--r)', fontSize: 12, fontWeight: 700 }}>
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                      {isEditingThis ? (
                        <>
                          <textarea className="fi2" style={{ minHeight: 50, resize: 'vertical', width: '100%' }}
                            value={editObsText} maxLength={1000}
                            onChange={(e) => setEditObsText(e.target.value)} />
                          <div className="mactions" style={{ marginTop: 6 }}>
                            <button className="bpri"
                              disabled={editObsMut.isPending || !editObsText.trim() || editObsText.trim() === obs.text}
                              onClick={() => editObsMut.mutate({ obsId: obs.id, text: editObsText.trim() })}>
                              {editObsMut.isPending ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button className="bsec" onClick={() => setEditingObsId(null)}>Cancelar</button>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{obs.text}</div>
                      )}
                    </div>
                  );
                })}
                {order.observations.length > 1 && (
                  <div className={`hist-toggle${obsExpanded ? ' open' : ''}`} onClick={() => setObsExpanded(!obsExpanded)}>
                    <ChevronDown size={16} style={{ transition: 'transform .2s', transform: obsExpanded ? 'rotate(180deg)' : 'none' }} />
                    {obsExpanded ? 'Mostrar solo la más reciente' : `Ver las ${order.observations.length} observaciones`}
                  </div>
                )}
              </div>
            )}
            <textarea ref={obsTextareaRef} className="fi2" style={{ minHeight: 50, resize: 'vertical', width: '100%' }}
              placeholder={order.observations && order.observations.length > 0 ? 'Agregar otra observación...' : 'Nota interna - se puede agregar incluso después de cerrado el pedido'}
              value={newObsText}
              maxLength={1000}
              onChange={(e) => setNewObsText(e.target.value)}
              onKeyDown={handleObsArrowKeys}
            />
            <div className="mactions" style={{ marginBottom: 14 }}>
              <button ref={saveObsBtnRef} onKeyDown={handleSaveObsBtnKeyDown} className="bsec"
                onClick={() => addObsMut.mutate(newObsText.trim())}
                disabled={addObsMut.isPending || !newObsText.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle size={13} /> {addObsMut.isPending ? 'Guardando...' : 'Guardar observación'}
              </button>
            </div>

            {/* History - visible to whoever can manage this order */}
            {canManage && order.history && order.history.length > 0 && (
              <div>
                <div ref={historyToggleRef} tabIndex={0} onKeyDown={handleHistoryToggleKeyDown}
                  className={`hist-toggle${showHist ? ' open' : ''}`} onClick={() => setShowHist(!showHist)}>
                  <ChevronDown size={16} style={{ transition: 'transform .2s', transform: showHist ? 'rotate(180deg)' : 'none' }} />
                  Historial de cambios
                  <span style={{ background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
                    {order.history.length}
                  </span>
                </div>
                {showHist && (
                  <div style={{ marginBottom: 14 }}>
                    <HistoryTable history={order.history} />
                  </div>
                )}
              </div>
            )}

            {hasNegativePrice && (
              <div style={{
                background: 'var(--rc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 10,
                fontSize: 13, color: 'var(--r)', fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Precio negativo en {negativePriceItems.map((i: any) => i.product_name).join(', ')} - corrígelo para poder guardar, copiar, generar el PDF, enviar la factura o mover a papelera.</span>
              </div>
            )}
            <div className="mactions" style={{ flexWrap: 'wrap' }}>
              {canEditLocked && order.payment_method === 'credito' && !order.paid && (
                <button ref={actionBtnRef(0)} onKeyDown={handleActionBtnKeyDown} className="bverde"
                  onClick={() => setConfirmDlg({ msg: '¿Marcar este crédito como pagado?', onOk: () => creditoPagadoMut.mutate() })}
                  disabled={creditoPagadoMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircle size={13} /> {creditoPagadoMut.isPending ? 'Guardando...' : 'Marcar crédito pagado'}
                </button>
              )}
              {/* Corrige un pedido que cierre cerró "sin cobro" por error - la
                  única forma de arreglarlo, ya que POST /:id/cobro rechaza de
                  plano cualquier pedido ya bloqueado (locked), sin importar el
                  motivo. Nunca aparece para crédito (tiene su propio botón
                  arriba) ni para un pedido que sí se cobró normalmente. */}
              {canEditLocked && order.locked && !order.paid && order.status === 'cerrado' && order.payment_method !== 'credito' && (
                <button className="bverde"
                  onClick={() => setConfirmDlg({
                    msg: 'Este pedido quedó cerrado "sin cobro" en el cierre de caja. ¿Confirmas que sí se cobró y quieres marcarlo como pagado?',
                    onOk: () => cobroRetroactivoMut.mutate(),
                  })}
                  disabled={cobroRetroactivoMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircle size={13} /> {cobroRetroactivoMut.isPending ? 'Guardando...' : 'Marcar como cobrado'}
                </button>
              )}
              {!readOnly && !locked && canManage && order.status !== 'papelera' && (
                <button ref={actionBtnRef(1)} onKeyDown={handleActionBtnKeyDown} className="bdel"
                  onClick={() => { setPapeleraReasonText(''); setPapeleraReasonDlg(true); }}
                  disabled={papeleraMut.isPending || hasNegativePrice}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Trash2 size={13} /> Papelera
                </button>
              )}
              {!readOnly && (
                <button ref={actionBtnRef(2)} onKeyDown={handleActionBtnKeyDown} className="bpri"
                  onClick={() => {
                    if (items.length === 0) { toast('El pedido debe tener al menos un producto', true); return; }
                    if (hasNegativePrice) { toast('Hay un precio negativo - corrígelo antes de guardar', true); return; }
                    // Completo/vuelta is only required to CERRAR (cobro dialog,
                    // cierreMissing below already covers that) - guardando el
                    // pedido a medio llenar (ej. aún no se sabe cómo paga) debe
                    // funcionar siempre, sin bloquear por este campo.
                    triggerSave();
                  }}
                  disabled={saveMut.isPending || !(isDirty || catalogDirty) || hasNegativePrice}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: (isDirty || catalogDirty) ? 1 : 0.5 }}>
                  <CheckCircle size={13} /> {saveMut.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              )}
              {items.length > 0 && (
                <button ref={actionBtnRef(3)} onKeyDown={handleActionBtnKeyDown} className="bsec" onClick={copyInvoice} disabled={hasNegativePrice}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileText size={13} /> Copiar
                </button>
              )}
              {items.length > 0 && (
                <button ref={actionBtnRef(4)} onKeyDown={handleActionBtnKeyDown} className="bsec" onClick={generatePDF} disabled={hasNegativePrice}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileText size={13} /> PDF
                </button>
              )}
              {items.length > 0 && order.ticket_id && (() => {
                // Once the order's already on its way/delivered/closed, sending the
                // factura again doesn't make sense - but this must re-enable itself
                // the instant the status goes back to 'listo' (e.g. a mistaken
                // advance gets reverted) for whoever still has the modal open,
                // with no refresh. `order.status` is already kept live here via the
                // order:updated/order:paid socket listener above, so a plain
                // re-read on every render is all this needs - no separate effect.
                const enRuta = ['camino', 'entregado', 'cerrado'].includes(order.status);
                return (
                  <button ref={actionBtnRef(5)} onKeyDown={handleActionBtnKeyDown} className="bsec" onClick={sendInvoiceToChat}
                    disabled={invoiceMut.isPending || hasNegativePrice || enRuta}
                    title={enRuta ? 'El pedido ya está en camino, entregado o cerrado' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, borderColor: 'var(--v)', color: 'var(--v)' }}>
                    <Send size={13} /> {invoiceMut.isPending ? 'Enviando...' : 'Enviar factura'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* CLIENT-DELETED DECISION DIALOG - pops automatically on open, same as the
          cobro dialog does with openCobro, since this needs a staff decision
          before anything else about the order matters. */}
      {order.client_deleted && !clientDeletedDismissed && (
        <div className="moverlay on" style={{ zIndex: 700 }}>
          <div className="cobrobox">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <AlertTriangle size={32} color="var(--r)" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 8, color: 'var(--r)' }}>
              El cliente eliminó este pedido
            </div>
            <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--gt)', marginBottom: 20 }}>
              Pedido #{order.num} - {order.customer_name}
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button className="bsec" onClick={() => setClientDeletedDismissed(true)}>
                Mantener eliminado
              </button>
              <button className="bpri" onClick={() => restoreMut.mutate()} disabled={restoreMut.isPending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                {restoreMut.isPending ? 'Restaurando...' : <><CheckCircle size={15} /> Restaurar pedido</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAPELERA REASON DIALOG - mandatory free-text motivo, not a plain confirm */}
      {papeleraReasonDlg && (
        <div className="moverlay on" style={{ zIndex: 900 }} onClick={(e) => e.target === e.currentTarget && setPapeleraReasonDlg(false)}>
          <div className="mwin" style={{ maxWidth: 400 }}>
            <div className="mbody" style={{ padding: '24px 22px 20px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n)', marginBottom: 12 }}>
                ¿Mover este pedido a la papelera?
              </div>
              <textarea
                autoFocus
                value={papeleraReasonText}
                onChange={(e) => setPapeleraReasonText(e.target.value)}
                placeholder="Motivo (obligatorio)..."
                rows={3}
                style={{ width: '100%', resize: 'vertical', marginBottom: 16 }}
              />
              <div className="mactions" style={{ justifyContent: 'center' }}>
                <button className="bsec" onClick={() => setPapeleraReasonDlg(false)}>Cancelar</button>
                <button className="bdel"
                  disabled={!papeleraReasonText.trim() || papeleraMut.isPending}
                  onClick={() => {
                    papeleraMut.mutate(papeleraReasonText.trim());
                    setPapeleraReasonDlg(false);
                  }}>
                  {papeleraMut.isPending ? 'Enviando...' : 'Enviar a papelera'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DIALOG */}
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.msg}
          danger={confirmDlg.danger}
          cancelLabel={confirmDlg.onSave ? 'Salir' : 'Cancelar'}
          onSave={confirmDlg.onSave}
          savePending={saveMut.isPending || addObsMut.isPending || editObsMut.isPending}
          onConfirm={() => { confirmDlg.onOk(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}

      {/* COBRO DIALOG */}
      {showCobro && (
        <div className="moverlay on" style={{ zIndex: 700 }}>
          <div className="cobrobox">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Banknote size={32} color="var(--v)" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Confirmar pago</div>
            <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--gt)', marginBottom: 16 }}>
              {order.customer_name} - Total: <strong>{fmtCOP(total)}</strong>
            </div>
            <div style={{ background: 'var(--ac)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--a)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> Una vez confirmado, el pedido quedará bloqueado.
            </div>
            {cierreMissing.length > 0 && (
              <div style={{ background: 'var(--rc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--r)', fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Falta completar antes de cerrar: {cierreMissing.join(', ')}.</span>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: splitPayment ? 10 : 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={splitPayment}
                onChange={(e) => { setSplitPayment(e.target.checked); setSplitCash(''); setSplitTransfer(''); }} />
              ¿Pago dividido entre efectivo y transferencia?
            </label>
            {splitPayment && (
              <div style={{ background: 'var(--bg)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', padding: '10px 12px', marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="fl2">Efectivo</label>
                    <input className="fi2 no-spin" type="number" min="0" placeholder="$0"
                      value={splitCash} onChange={(e) => setSplitCash(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="fl2">Transferencia</label>
                    <input className="fi2 no-spin" type="number" min="0" placeholder="$0"
                      value={splitTransfer} onChange={(e) => setSplitTransfer(e.target.value)} />
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: splitValid ? 'var(--v)' : 'var(--r)' }}>
                  {splitValid
                    ? `✓ Suman el total (${fmtCOP(total)})`
                    : `Deben sumar exactamente ${fmtCOP(total)} - van ${fmtCOP(splitCashNum + splitTransferNum)}`}
                </div>
              </div>
            )}
            <div className="fg2">
              <label className="fl2">¿Quién recibió el pago?</label>
              <div className="fi2" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--gm)', cursor: 'default' }}>
                {user?.name ?? 'Usuario actual'}
              </div>
            </div>
            <div className="fg2" style={{ marginTop: 12 }}>
              <label className="fl2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={13} /> Tu contraseña para confirmar <span style={{ color: 'var(--r)', fontWeight: 800 }}>*</span>
              </label>
              <PasswordInput ref={cobroPassRef} className="fi2" placeholder="Contraseña de tu sesión"
                value={cobroPass} onChange={(e) => setCobroPass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cobroValido && !cobroMut.isPending) { e.preventDefault(); cobroMut.mutate(splitPayment ? total : recibido); return; }
                  if (e.key === 'ArrowDown') { e.preventDefault(); cobroConfirmBtnRef.current?.focus(); }
                }}
                autoComplete="current-password" />
              <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 4 }}>
                Requerida para evitar cobros no autorizados
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <button className="bsec" onClick={onClose}
                onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); cobroPassRef.current?.focus(); } else if (e.key === 'ArrowRight') { e.preventDefault(); cobroConfirmBtnRef.current?.focus(); } }}>
                Cancelar
              </button>
              <button ref={cobroConfirmBtnRef} className="bpri" onClick={() => cobroMut.mutate(splitPayment ? total : recibido)}
                onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); cobroPassRef.current?.focus(); } }}
                disabled={cobroMut.isPending || !cobroValido}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: cobroValido ? 1 : 0.5 }}>
                {cobroMut.isPending ? 'Confirmando...' : <><CheckCircle size={15} /> Confirmar pago</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {forwardMsg && order?.ticket_id && (
        <ForwardMessageModal message={forwardMsg} currentTicketId={order.ticket_id} onClose={() => setForwardMsg(null)} />
      )}
    </div>
  );
}
