import { Fragment, useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { Smartphone, Check, Send, ClipboardList, Ban, AlertTriangle, Paperclip, ListChecks } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProducts } from '../../hooks/useProducts';
import ChatImage from '../ui/ChatImage';
import ChatAudio from '../ui/ChatAudio';
import ChatVideo from '../ui/ChatVideo';
import ChatDocument from '../ui/ChatDocument';
import ChatLocation from '../ui/ChatLocation';
import { useSendChatMedia, CHAT_MEDIA_ACCEPT } from '../../hooks/useSendChatMedia';
import { buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../../lib/formLinkMessage';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { useEmployees } from '../../hooks/useEmployees';
import { useCreateOrder } from '../../hooks/useOrders';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { toast } from '../ui/Toast';
import DeliveryStatus from '../ui/DeliveryStatus';
import { ConfirmModal } from '../ui/ConfirmModal';
import ProductSearch, { ProductSearchHandle } from '../orders/ProductSearch';
import CodPaymentField from '../orders/CodPaymentField';
import { todayStr, formatChatTimestamp, formatChatDateDivider, colombiaDateStr } from '../../lib/format';
import { useDiaCerrado } from '../../hooks/useCierre';
import { useTomarLista, TomarListaItem } from '../../hooks/useTomarLista';
import { mergeExtractedItems } from '../../lib/tomarLista';
import { TomarListaActionBar } from '../chat/TomarListaActionBar';
import { TomarListaResultModal } from '../chat/TomarListaResultModal';

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

interface Props {
  fecha: string;
  onClose: () => void;
  ticketId?: string;
  preNombre?: string;
  prePhone?: string;
  messages?: { text: string; direction: string; created_at?: string }[];
  // "Tomar lista" from TicketModal (no order-item UI of its own): items already
  // extracted+matched by AI, dropped straight into this brand-new order's draft.
  prefillItems?: TomarListaItem[];
}

export default function NuevoPedidoModal({ fecha, onClose, ticketId, preNombre, prePhone, messages: initialMessages, prefillItems }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const canTomarLista = user?.role === 'admin' || user?.role === 'encargado' || user?.role === 'dev';
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const createOrder = useCreateOrder();

  const [pago, setPago] = useState('sin_asignar');
  // Neither selected by default - staff must actively pick one once "Cobro en casa"
  // is chosen, not fall into a silent default (see codChoice usage below).
  const [codChoice, setCodChoice] = useState<'completo' | 'vuelta' | null>(null);
  const [codCash, setCodCash] = useState('');
  const [nombre, setNombre] = useState(preNombre ?? '');
  // Display-only, from the ticket's real WhatsApp number - never user-editable
  // (see the disabled input below), so no setter needed.
  const [telefono] = useState(prePhone ?? '');
  const [direccion, setDireccion] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>(() => prefillItems?.length ? mergeExtractedItems([], prefillItems) : []);
  const productSearchRef = useRef<ProductSearchHandle>(null);
  const [replyText, setReplyText] = useState('');

  // "Tomar lista" - see hooks/useTomarLista.ts.
  const tomarLista = useTomarLista(ticketId);
  const [tomarListaResult, setTomarListaResult] = useState<{ items: TomarListaItem[]; unmatchedNames: string[] } | null>(null);

  function handleProcesarTomarLista() {
    tomarLista.mutation.mutate(undefined, {
      onSuccess: (res: any) => {
        const { items: extracted, unmatchedNames } = res.data;
        tomarLista.clear();
        if (unmatchedNames.length === 0) {
          setItems((prev: any[]) => mergeExtractedItems(prev, extracted));
          toast('Lista montada exitosamente');
        } else {
          setTomarListaResult({ items: extracted, unmatchedNames });
        }
      },
      onError: (e: any) => toast(e.message ?? 'No se pudo procesar el texto con IA - intenta de nuevo', true),
    });
  }

  // Whole-form keyboard nav, same pattern/graph as DetallePedidoModal: nombre ->
  // dirección -> pago/domiciliario -> catálogo -> Cancelar/Registrar, so the
  // whole "crear pedido" flow is usable without a mouse too, not just editing
  // an existing one.
  const nombreRef = useRef<HTMLInputElement>(null);
  const direccionRef = useRef<HTMLInputElement>(null);
  const pagoRef = useRef<HTMLSelectElement>(null);
  const empleadoRef = useRef<HTMLSelectElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  function handleFormArrowKeys(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, field: 'nombre' | 'direccion' | 'pago' | 'empleado') {
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
  function handleNewOrderActionBtnKeyDown(e: KeyboardEvent<HTMLButtonElement>, which: 'cancel' | 'submit') {
    if (e.key === 'ArrowUp') { e.preventDefault(); productSearchRef.current?.focusManualLast(); return; }
    if (e.key === 'ArrowRight' && which === 'cancel') { e.preventDefault(); submitBtnRef.current?.focus(); return; }
    if (e.key === 'ArrowLeft' && which === 'submit') { e.preventDefault(); cancelBtnRef.current?.focus(); }
  }

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInnerRef = useRef<HTMLDivElement>(null);

  // Live chat data from API
  const { data: convoData } = useQuery({
    queryKey: ['inbox-convo', ticketId],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages`).then((r) => r.data),
    enabled: !!ticketId,
    refetchInterval: 60000, // fallback only - real-time delivery is via socket below
  });

  // This modal never had a socket listener at all, only the interval above - meaning a
  // message arriving while it's open could sit unseen for up to 15-60s. Same pattern as
  // TicketModal/DetallePedidoModal. ticket:message-status (delivery/read/failure
  // updates on a message already shown) was missing the same way in all three.
  useEffect(() => {
    if (!accessToken || !ticketId) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['inbox-convo', ticketId] });
    };
    const onMsgStatus = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['inbox-convo', ticketId] });
    };
    sock.on('ticket:message', onMsg);
    sock.on('ticket:message-status', onMsgStatus);
    return () => {
      sock.off('ticket:message', onMsg);
      sock.off('ticket:message-status', onMsgStatus);
    };
  }, [accessToken, ticketId, qc]);

  const liveMessages: any[] = convoData?.messages ?? initialMessages ?? [];

  // Keeps the chat pinned to the bottom, not just when a new message arrives but
  // also when an already-shown row grows AFTER that (an image finishing its async
  // load, see ChatImage) - scrolling only on message-count change fired too early
  // for images, leaving the bottom of the photo cut off until manually scrolled.
  useEffect(() => {
    const outer = chatScrollRef.current;
    const inner = chatInnerRef.current;
    if (!outer || !inner) return;
    const stick = () => { outer.scrollTop = outer.scrollHeight; };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [ticketId]);

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${ticketId}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', ticketId] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setReplyText('');
    },
    onError: (e: any) => toast(e.message ?? 'Error al enviar', true),
  });

  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const { pickAndSend: pickAndSendChatMedia, isPending: sendMediaPending } = useSendChatMedia(ticketId, [['inbox-convo', ticketId], ['inbox']]);
  async function handleChatPickMedia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await pickAndSendChatMedia(file);
  }

  const blockLinkMut = useMutation({
    mutationFn: () => api.post(`/inbox/${ticketId}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  function handleSend() {
    if (!replyText.trim() || replyMut.isPending) return;
    replyMut.mutate(replyText.trim());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasDirty = nombre.trim() !== (preNombre ?? '').trim()
    || telefono.trim() !== (prePhone ?? '').trim()
    || direccion.trim() !== ''
    || items.length > 0;
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void; onSave?: () => void } | null>(null);

  function handleClose() {
    if (hasDirty) {
      setConfirmDlg({
        msg: 'Hay datos sin guardar.',
        onOk: onClose,
        onSave: () => { handleSubmit(); setConfirmDlg(null); },
      });
      return;
    }
    onClose();
  }

  const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
  const codCashNum = parseFloat(codCash) || 0;
  // Same guard as DetallePedidoModal - a negative price must block the save, not
  // just fail quietly server-side (orderItemSchema's price: z.number().min(0)).
  const hasNegativePrice = items.some((i: any) => parseFloat(i.price) < 0);

  async function handleSubmit() {
    if (!ticketId) { toast('El pedido debe crearse desde un ticket de WhatsApp', true); return; }
    if (!nombre.trim()) { toast('El nombre es obligatorio', true); return; }
    if (hasNegativePrice) { toast('Hay un precio negativo - corrígelo antes de registrar el pedido', true); return; }
    // Commits whatever row is still mid-edit in the Factbox table (typed but never
    // confirmed with Enter/✓) BEFORE reading items for the payload below - otherwise
    // clicking straight from typing a price into this button silently dropped that
    // edit, the exact bug report this fixes. Returns the merged array synchronously;
    // `items` state itself only catches up on the next render, too late for this call.
    const finalItems = productSearchRef.current?.commitPendingEdit() ?? items;
    if (finalItems.length === 0) { toast('Agrega al menos un producto', true); return; }
    if (finalItems.some((i: any) => parseFloat(i.price) < 0)) { toast('Hay un precio negativo - corrígelo antes de registrar el pedido', true); return; }
    const finalTotal = finalItems.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const finalCodAmount = codChoice === 'completo' ? finalTotal : codChoice === 'vuelta' ? codCashNum : null;
    // Completo/vuelta is only required to CERRAR the order later, not to
    // register it now - a domiciliario often doesn't know yet how the client
    // will actually pay when the pedido is first created.
    try {
      await createOrder.mutateAsync({
        fecha,
        ticket_id: ticketId,
        payment_method: pago,
        customer_name: nombre.trim(),
        // No customer_phone - this modal always requires a ticketId (checked above),
        // and the backend always sets the phone from that ticket's real WhatsApp
        // number, never from a typed value (orders.ts's POST /).
        address: direccion.trim() || undefined,
        employee_id: empleadoId || undefined,
        amount_received: pago === 'cod' ? finalCodAmount : undefined,
        cod_choice: pago === 'cod' ? codChoice : undefined,
        items: finalItems.map((i: any, idx: number) => ({
          product_name: i.product_name,
          quantity_label: i.quantity_label || '',
          price: parseFloat(i.price) || 0,
          sort_order: idx,
          ai_unmatched: !!i.ai_unmatched,
        })),
      });
      toast('Pedido registrado');
      onClose();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  const hasChat = !!ticketId;
  // Same reasoning as TicketModal/DetallePedidoModal - the link itself already
  // expires (24h from issuance, or 4h if never opened), so a past day's ticket
  // very likely has nothing live to send/block. Also true the moment TODAY's caja
  // gets closed early.
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const isPastDay = fecha < todayStr() || (cierreStatus?.cerrado ?? false);

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row', width: '100%',
        maxWidth: hasChat ? 1040 : 700,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease', maxHeight: '90vh',
      }}>
        {hasChat && (
          <div style={{ width: 380, background: '#ECE5DD', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '10px 12px', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={15} />
              <span style={{ flex: 1 }}>{preNombre || formatPhoneDisplay(telefono)}</span>
              {ticketId && (
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este ticket es de un día anterior - el link ya expiró' : 'Enviar formulario de pedido al cliente'}
                  disabled={isPastDay}
                  onClick={async () => {
                    let url: string;
                    try {
                      const res = await api.get<{ data: { url: string } }>(`/inbox/${ticketId}/form-link`);
                      url = res.data.url;
                    } catch { toast('No se pudo generar el link', true); return; }
                    try {
                      // Three separate messages, in order (awaited, not fire-and-
                      // forget - each must arrive in this exact sequence).
                      await replyMut.mutateAsync(buildFormLinkWarningMessage());
                      await replyMut.mutateAsync(url);
                      await replyMut.mutateAsync(buildFormLinkFollowUpMessage());
                    } catch {
                      // replyMut's own onError already toasted the specific reason.
                    }
                  }}
                >
                  <ClipboardList size={13} />
                  Formulario
                </button>
              )}
              {ticketId && (
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este ticket es de un día anterior - el link ya expiró' : 'Bloquear el link de formulario enviado a este cliente'}
                  onClick={() => setShowBlockConfirm(true)}
                  disabled={blockLinkMut.isPending || isPastDay}
                >
                  <Ban size={13} />
                  <span>Bloquear<br />Link</span>
                </button>
              )}
              {ticketId && canTomarLista && (
                <button
                  className="hdr-ic-btn"
                  title="Seleccionar mensajes del cliente para armar el pedido"
                  onClick={() => tomarLista.toggle()}
                  disabled={isPastDay}
                >
                  <ListChecks size={13} />
                  <span>Tomar<br />lista</span>
                </button>
              )}
            </div>
            {convoData?.no_wpp_number && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 0, padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <AlertTriangle size={14} /> Este ticket llegó sin número de WhatsApp - no se puede responder.
              </div>
            )}
            <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
             <div ref={chatInnerRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {liveMessages.map((m: any, i: number, arr: any[]) => {
                const day = colombiaDateStr(m.created_at ?? m.sent_at);
                const prevDay = i > 0 ? colombiaDateStr(arr[i - 1].created_at ?? arr[i - 1].sent_at) : null;
                const showDivider = day !== prevDay;
                return (
                <Fragment key={i}>
                {showDivider && (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
                    <span style={{ background: '#e9edef', color: '#54656f', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8 }}>
                      {formatChatDateDivider(m.created_at ?? m.sent_at)}
                    </span>
                  </div>
                )}
                {(() => {
                  const bubbleContent = (
                    <>
                      {m.media_type === 'image' && <div className="chat-bubble"><ChatImage token={m.media_url} caption={m.media_caption ?? m.text} /></div>}
                      {m.media_type === 'audio' && <div className="chat-bubble"><ChatAudio token={m.media_url} /></div>}
                      {m.media_type === 'video' && <div className="chat-bubble"><ChatVideo token={m.media_url} caption={m.media_caption ?? m.text} /></div>}
                      {m.media_type === 'document' && <div className="chat-bubble"><ChatDocument token={m.media_url} filename={m.media_caption} caption={m.media_caption ? m.text : null} /></div>}
                      {m.media_type === 'location' && <div className="chat-bubble"><ChatLocation url={m.media_url} label={m.text} /></div>}
                      {!m.media_type && <div className="chat-bubble" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(m.text)}</div>}
                      {(m.sent_at || m.created_at) && (
                        <div className="chat-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start' }}>
                          {formatChatTimestamp(m.sent_at ?? m.created_at)}
                          {m.direction === 'out' && m.wpp_message_id && (
                            <DeliveryStatus delivered={m.delivered} read_by_client={m.read_by_client} failed_reason={m.failed_reason} />
                          )}
                        </div>
                      )}
                    </>
                  );
                  return tomarLista.active && tomarLista.isEligible(m) ? (
                    <div
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, alignSelf: 'flex-start', maxWidth: '80%', cursor: 'pointer' }}
                      onClick={() => tomarLista.toggleMsg(m.id)}
                    >
                      <input
                        type="checkbox"
                        checked={tomarLista.selectedIds.has(m.id)}
                        onChange={() => tomarLista.toggleMsg(m.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 8, width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div className="chat-msg them" style={{ maxWidth: '100%' }}>{bubbleContent}</div>
                    </div>
                  ) : (
                    <div className={`chat-msg ${m.direction === 'out' ? 'us' : 'them'}`}>{bubbleContent}</div>
                  );
                })()}
                </Fragment>
                );
              })}
             </div>
            </div>
            {/* Reply input - replaced by the Tomar lista action bar while that
                selection mode is active. */}
            {tomarLista.active ? (
              <TomarListaActionBar
                count={tomarLista.selectedIds.size}
                pending={tomarLista.mutation.isPending}
                onCancel={() => tomarLista.clear()}
                onClearSelection={() => tomarLista.clearSelection()}
                onProcess={handleProcesarTomarLista}
              />
            ) : (
              <div style={{ background: '#F0F2F0', padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'flex-end', borderTop: '1px solid #D0D8D0' }}>
                <input ref={chatFileInputRef} type="file" accept={CHAT_MEDIA_ACCEPT} onChange={handleChatPickMedia} style={{ display: 'none' }} />
                <button
                  title="Adjuntar foto, audio, video o documento"
                  onClick={() => chatFileInputRef.current?.click()}
                  disabled={sendMediaPending}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', padding: '8px 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                >
                  <Paperclip size={17} />
                </button>
                <textarea
                  rows={2}
                  placeholder="Escribe un mensaje... (Enter para enviar)"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{
                    flex: 1, resize: 'none', border: '1.5px solid var(--brd)',
                    borderRadius: 10, padding: '7px 10px', fontSize: 13,
                    fontFamily: 'var(--f)', background: '#fff', outline: 'none',
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!replyText.trim() || replyMut.isPending}
                  style={{
                    background: replyText.trim() ? 'var(--v)' : 'var(--gm)',
                    border: 'none', borderRadius: 10, padding: '8px 10px',
                    cursor: replyText.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .15s',
                  }}
                >
                  <Send size={16} color={replyText.trim() ? '#fff' : 'var(--gt)'} />
                </button>
              </div>
            )}
          </div>
        )}
        {tomarListaResult && (
          <TomarListaResultModal
            unmatchedNames={tomarListaResult.unmatchedNames}
            eligibleOrders={[]}
            onConfirm={() => {
              setItems((prev: any[]) => mergeExtractedItems(prev, tomarListaResult.items));
              setTomarListaResult(null);
            }}
            onCancel={() => setTomarListaResult(null)}
          />
        )}

        <div className="mwin" style={{
          margin: 0, flex: 1,
          borderRadius: hasChat ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
          boxShadow: 'none',
        }}>
          <div className="mhead">
            <div className="mtit">Crear pedido desde ticket</div>
            <button className="mclose" onClick={handleClose}>×</button>
          </div>
          <div className="mbody">
            {ticketId && (
              <div style={{ background: 'var(--vc)', border: '2px solid var(--vm)', color: 'var(--vd)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Smartphone size={14} /> Pedido vinculado al ticket de WhatsApp
              </div>
            )}
            {/* Purely informational - a client can freely accumulate more than one
                unpaid crédito order at once (admin's own call), this never blocks
                creating/editing/closing this new one. Just a heads-up so encargado
                knows to check with admin if needed. */}
            {convoData?.orders?.some((o: any) => o.payment_method === 'credito' && !o.paid) && (
              <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} /> Este cliente tiene un pedido a crédito no pagado.
              </div>
            )}
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Nombre del cliente *</label>
                <input ref={nombreRef} className="fi2" placeholder="Ej: María González" value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  onKeyDown={(e) => handleFormArrowKeys(e, 'nombre')} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                {/* Always disabled - this modal only ever creates orders linked to a
                    ticket (handleSubmit blocks otherwise), and the backend always
                    takes the phone from that ticket's real WhatsApp number. */}
                <input className="fi2" disabled value={formatPhoneDisplay(telefono)} title="El teléfono es el número de WhatsApp del ticket - no se puede modificar" />
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">Dirección de entrega <span style={{ fontWeight: 400, color: 'var(--gt)' }}>(opcional, requerida solo para cerrar el pedido)</span></label>
              <input ref={direccionRef} className="fi2" placeholder="Ej: Cra 45 #12-34, Casa azul" value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                onKeyDown={(e) => handleFormArrowKeys(e, 'direccion')} />
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select ref={pagoRef} className="fi2" value={pago} onChange={(e) => {
                  setPago(e.target.value);
                  // Reset the cod choice on any change away from/back to 'cod' -
                  // otherwise switching payment method and back could resurrect a
                  // stale choice/amount that no longer matches what's on screen.
                  setCodChoice(null); setCodCash('');
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
                <select ref={empleadoRef} className="fi2" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}
                  onKeyDown={(e) => handleFormArrowKeys(e, 'empleado')}>
                  <option value="">Sin asignar</option>
                  {employees.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {pago === 'cod' && (
              <CodPaymentField total={total} choice={codChoice} onChoiceChange={setCodChoice} cash={codCash} onCashChange={setCodCash} />
            )}
            <div className="stit">Productos</div>
            <ProductSearch ref={productSearchRef} products={products} items={items} onChange={setItems}
              onArrowUpFromSearch={() => pagoRef.current?.focus()}
              onArrowDownFromManual={() => cancelBtnRef.current?.focus()}
            />
            {hasNegativePrice && (
              <div style={{
                background: 'var(--rc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginTop: 10,
                fontSize: 13, color: 'var(--r)', fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Hay un precio negativo - corrígelo para poder registrar el pedido.</span>
              </div>
            )}
            <div className="mactions">
              <button ref={cancelBtnRef} onKeyDown={(e) => handleNewOrderActionBtnKeyDown(e, 'cancel')} className="bsec" onClick={handleClose}>Cancelar</button>
              <button ref={submitBtnRef} onKeyDown={(e) => handleNewOrderActionBtnKeyDown(e, 'submit')} className="bpri" onClick={handleSubmit} disabled={createOrder.isPending || hasNegativePrice}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                {createOrder.isPending
                  ? 'Registrando...'
                  : <><Check size={15} strokeWidth={3} /> Registrar pedido</>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.msg}
          cancelLabel={confirmDlg.onSave ? 'Salir' : 'Cancelar'}
          onSave={confirmDlg.onSave}
          savePending={createOrder.isPending}
          onConfirm={() => { confirmDlg.onOk(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      {showBlockConfirm && (
        <ConfirmModal
          message="Vas a bloquear el link del formulario - el cliente no podrá usarlo y tendrás que enviarle uno nuevo. ¿Deseas bloquearlo?"
          confirmLabel="Bloquear"
          danger
          onConfirm={() => { blockLinkMut.mutate(); setShowBlockConfirm(false); }}
          onCancel={() => setShowBlockConfirm(false)}
        />
      )}
    </div>
  );
}
