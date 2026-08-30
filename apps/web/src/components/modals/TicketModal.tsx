import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useRef, useEffect, useState, KeyboardEvent, ChangeEvent } from 'react';
import { Check, SendHorizontal, ArrowRight, Lock, ClipboardList, Ban, Paperclip, AlertTriangle, Forward, ListChecks } from 'lucide-react';
import DeliveryStatus from '../ui/DeliveryStatus';
import ChatImage from '../ui/ChatImage';
import ChatAudio from '../ui/ChatAudio';
import ChatVideo from '../ui/ChatVideo';
import ChatDocument from '../ui/ChatDocument';
import ChatLocation from '../ui/ChatLocation';
import ForwardMessageModal from '../ui/ForwardMessageModal';
import { useSendChatMedia, CHAT_MEDIA_ACCEPT } from '../../hooks/useSendChatMedia';
import { api } from '../../lib/api';
import { buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../../lib/formLinkMessage';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { fmtCOP, STATUS_LABEL, todayStr, formatChatTimestamp, formatChatDateDivider, colombiaDateStr } from '../../lib/format';
import { useDiaCerrado } from '../../hooks/useCierre';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useTomarLista, TomarListaItem } from '../../hooks/useTomarLista';
import { TomarListaActionBar } from '../chat/TomarListaActionBar';
import { TomarListaResultModal } from '../chat/TomarListaResultModal';
import { EnviarCatalogoMenu } from '../chat/EnviarCatalogoMenu';
import { useProducts } from '../../hooks/useProducts';

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
  ticketId: string;
  fecha: string;
  onClose: () => void;
  onCreateFromTicket?: (ticket: any, prefillItems?: TomarListaItem[]) => void;
  onOpenOrder?: (orderId: string, prefillItems?: TomarListaItem[]) => void;
}

export default function TicketModal({ ticketId, fecha, onClose, onCreateFromTicket, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const canTomarLista = user?.role === 'admin' || user?.role === 'encargado' || user?.role === 'dev';
  const [reply, setReply] = useState('');
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<any | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Orders shown here must be scoped to the day currently being viewed on the board
  // (fecha), not every order this ticket ever had - opening today's chat for a
  // customer who also ordered yesterday must not show yesterday's pedido here.
  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId, fecha],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages?fecha=${fecha}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    };
    // Delivery/read/failure updates on a message already shown here - same
    // invalidate-and-refetch as a new message, just a different trigger.
    const onMsgStatus = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    };
    // Orders embedded in this ticket's card list must reflect status/paid changes
    // immediately, not just when a new chat message happens to trigger a refetch.
    const onOrderChange = () => qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    sock.on('ticket:message', onMsg);
    sock.on('ticket:message-status', onMsgStatus);
    sock.on('order:moved', onOrderChange);
    sock.on('order:updated', onOrderChange);
    sock.on('order:paid', onOrderChange);
    return () => {
      sock.off('ticket:message', onMsg);
      sock.off('ticket:message-status', onMsgStatus);
      sock.off('order:moved', onOrderChange);
      sock.off('order:updated', onOrderChange);
      sock.off('order:paid', onOrderChange);
    };
  }, [accessToken, ticketId, qc]);

  // Keeps the chat pinned to the bottom, not just when a new message arrives but
  // also when an already-shown row grows AFTER that (an image finishing its async
  // load, see ChatImage) - scrolling only on message-count change fired too early
  // for images, leaving the bottom of the photo cut off until manually scrolled.
  // ResizeObserver on the inner wrapper (not chatRef itself, whose own size is
  // fixed by its flex parent) catches both cases the same way.
  const chatInnerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outer = chatRef.current;
    const inner = chatInnerRef.current;
    if (!outer || !inner) return;
    const stick = () => { outer.scrollTop = outer.scrollHeight; };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [ticketId]);

  const sendMut = useMutation({
    mutationFn: () => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${ticketId}/reply`, { text: reply }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setReply('');
      // e.g. outside Meta's 24h customer-service window - the message still saves
      // and shows in the chat, so without this staff has no way to know it never
      // actually reached the client's WhatsApp.
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado, pero este negocio no tiene WhatsApp conectado', true);
      } else {
        toast('Mensaje enviado');
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { pickAndSend, isPending: sendMediaPending } = useSendChatMedia(ticketId, [['ticket', ticketId, fecha], ['tickets']]);

  async function handlePickMedia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await pickAndSend(file);
  }

  const formLinkMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${ticketId}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function sendFormLink() {
    let url: string;
    try {
      const res = await api.get<{ data: { url: string } }>(`/inbox/${ticketId}/form-link`);
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
    mutationFn: () => api.post(`/inbox/${ticketId}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });

  const activeOrders = (ticket?.orders ?? []).filter((o: any) => o.status !== 'papelera');
  const hasOrders = activeOrders.length > 0;

  // "Tomar lista" - see hooks/useTomarLista.ts. TicketModal has no order-item UI
  // of its own, so a successful extraction either opens NuevoPedidoModal (new
  // order) or DetallePedidoModal (merge into an existing one) pre-filled.
  const tomarLista = useTomarLista(ticketId);
  const { data: products = [] } = useProducts();
  const [tomarListaResult, setTomarListaResult] = useState<{ items: TomarListaItem[]; unmatchedNames: string[] } | null>(null);
  // Same status/locked/client_deleted eligibility rule public.ts's own merge
  // flow uses (EDITABLE_STATUSES = nuevo/preparando/listo) - source==='form' is
  // deliberately NOT required here: that check exists there because the client
  // may only touch their own form-submitted order, but here staff is the actor,
  // and staff can already edit any of the ticket's own orders via DetallePedidoModal
  // regardless of how it was created.
  const EDITABLE_STATUSES = ['nuevo', 'preparando', 'listo'];
  const eligibleOrders = activeOrders.filter((o: any) => EDITABLE_STATUSES.includes(o.status) && !o.locked && !o.client_deleted);

  function handleProcesarTomarLista() {
    tomarLista.mutation.mutate(undefined, {
      onSuccess: (res: any) => {
        const { items: extracted, unmatchedNames } = res.data;
        tomarLista.clear();
        if (unmatchedNames.length === 0 && eligibleOrders.length === 0) {
          toast('Lista montada exitosamente');
          onClose();
          onCreateFromTicket?.(ticket, extracted);
        } else {
          setTomarListaResult({ items: extracted, unmatchedNames });
        }
      },
      onError: (e: any) => toast(e.message ?? 'No se pudo procesar el texto con IA - intenta de nuevo', true),
    });
  }
  // The link itself already expires (24h from issuance, or 4h if never opened - see
  // formLink.ts) - viewing a past day's chat here means whatever link was ever sent
  // for it is very likely already dead, so sending/blocking one from this stale view
  // can only confuse ("bloqueado" a link that already expired, or a fresh link
  // that's really meant for TODAY's conversation, not the day being read). Also true
  // the moment TODAY's caja gets closed early (cierre.ts only allows closing today),
  // same as a past day for this purpose.
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const isPastDay = fecha < todayStr() || (cierreStatus?.cerrado ?? false);

  // The header button that TOGGLES Tomar lista is already disabled once
  // isPastDay - this covers the case where cierre happens WHILE staff is
  // already mid-selection (the button they used to get in isn't checked
  // again once they're already active) - kicks them out the same way every
  // other control on the day freezes, instead of leaving "Montar lista"
  // clickable on a day that's no longer editable.
  useEffect(() => {
    if (isPastDay && tomarLista.active) tomarLista.clear();
  }, [isPastDay, tomarLista.active]);

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row',
        width: '100%', maxWidth: 1110,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease', maxHeight: '90vh',
      }}>

        {/* ===== LEFT: CHAT ===== */}
        <div style={{
          width: 560, background: '#ECE5DD', display: 'flex',
          flexDirection: 'column', flexShrink: 0, minHeight: 0, overflow: 'hidden',
        }}>
          {/* Chat header */}
          <div style={{ background: 'var(--vd)', color: '#fff', padding: '14px 16px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {isLoading ? 'Cargando...' : ticket?.customer_name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {formatPhoneDisplay(ticket?.phone)}
                {ticket?.messages?.length != null && ` · ${ticket.messages.length} mensajes`}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flexShrink: 0, justifyContent: 'flex-end' }}>
              <button
                className="hdr-ic-btn"
                title={isPastDay ? 'Este chat es de un día anterior - el link ya expiró' : 'Enviar formulario de pedido al cliente'}
                onClick={sendFormLink}
                disabled={formLinkMut.isPending || isPastDay}
              >
                <ClipboardList size={13} />
                Formulario
              </button>
              <button
                className="hdr-ic-btn"
                title={isPastDay ? 'Este chat es de un día anterior - el link ya expiró' : 'Bloquear el link de formulario enviado a este cliente'}
                onClick={() => setShowBlockConfirm(true)}
                disabled={blockLinkMut.isPending || isPastDay}
              >
                <Ban size={13} />
                <span>Bloquear<br />Link</span>
              </button>
              <EnviarCatalogoMenu ticketId={ticketId} products={products} disabled={isPastDay} />
              {canTomarLista && (
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
          </div>

          {ticket?.no_wpp_number && (
            <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 0, padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <AlertTriangle size={14} /> Este ticket llegó sin número de WhatsApp - no se puede responder.
            </div>
          )}

          {/* Messages - scrollable */}
          <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '10px', minHeight: 0 }}>
           <div ref={chatInnerRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(ticket?.messages ?? []).map((msg: any, i: number, arr: any[]) => {
              const isOut = msg.direction === 'out';
              // WhatsApp-style day divider - shown whenever this message's calendar
              // day differs from the previous one (or it's the very first message).
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
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                  {tomarLista.active && tomarLista.isEligible(msg) && (
                    <input
                      type="checkbox"
                      checked={tomarLista.selectedIds.has(msg.id)}
                      onChange={() => tomarLista.toggleMsg(msg.id)}
                      style={{ marginTop: 8, width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                    />
                  )}
                  <div style={{
                    position: 'relative',
                    background: isOut ? '#DCF8C6' : '#fff',
                    borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '7px 10px', maxWidth: '85%', fontSize: 12,
                    boxShadow: '0 1px 2px rgba(0,0,0,.1)',
                    cursor: tomarLista.active && tomarLista.isEligible(msg) ? 'pointer' : undefined,
                  }}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId((id) => (id === msg.id ? null : id))}
                    onClick={() => { if (tomarLista.active && tomarLista.isEligible(msg)) tomarLista.toggleMsg(msg.id); }}>
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
                        onClick={(e) => { e.stopPropagation(); setForwardMsg(msg); }}
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
            {!isLoading && (!ticket?.messages || ticket.messages.length === 0) && (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Sin mensajes</div>
            )}
           </div>
          </div>

          {/* Reply bar - replaced by the Tomar lista action bar while that
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
            <div style={{
              background: '#F0F2F0', padding: '8px 10px',
              display: 'flex', gap: 6, alignItems: 'flex-end',
              borderTop: '1px solid #D0D8D0', flexShrink: 0,
            }}>
              <input ref={fileInputRef} type="file" accept={CHAT_MEDIA_ACCEPT} onChange={handlePickMedia} style={{ display: 'none' }} />
              <button
                title="Adjuntar foto, audio, video o documento"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendMediaPending}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)',
                  padding: '8px 4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                }}
              >
                <Paperclip size={17} />
              </button>
              <textarea
                rows={2}
                placeholder="Escribe un mensaje... (Enter para enviar)"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!sendMut.isPending && reply.trim()) sendMut.mutate();
                  }
                }}
                style={{
                  flex: 1, resize: 'none', border: '1.5px solid var(--brd)',
                  borderRadius: 10, padding: '7px 10px', fontSize: 12,
                  fontFamily: 'inherit', background: '#fff', outline: 'none',
                }}
              />
              <button
                onClick={() => { if (reply.trim() && !sendMut.isPending) sendMut.mutate(); }}
                disabled={!reply.trim() || sendMut.isPending}
                style={{
                  background: reply.trim() ? 'var(--v)' : 'var(--gm)',
                  border: 'none', borderRadius: 10, padding: '8px 10px',
                  cursor: reply.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background .15s', flexShrink: 0,
                }}
              >
                <SendHorizontal size={15} color={reply.trim() ? '#fff' : 'var(--gt)'} />
              </button>
            </div>
          )}
        </div>

        {/* ===== RIGHT: ORDERS ===== */}
        <div className="mwin" style={{
          margin: 0, flex: 1, minWidth: 0,
          borderRadius: '0 var(--radb) var(--radb) 0',
          boxShadow: 'none', maxHeight: '90vh',
        }}>
          <div className="mhead" style={{ borderRadius: '0 var(--radb) 0 0' }}>
            <div>
              <div className="mtit">{isLoading ? 'Cargando...' : ticket?.customer_name}</div>
              <div className="msub">
                {hasOrders ? `${activeOrders.length} pedido${activeOrders.length !== 1 ? 's' : ''} de esta fecha` : 'Sin pedidos en esta fecha'}
              </div>
            </div>
            <button className="mclose" onClick={onClose}>×</button>
          </div>

          <div className="mbody">
            {hasOrders ? (
              <div style={{ marginBottom: 4 }}>
                {activeOrders.map((o: any) => {
                  const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
                  return (
                    <div key={o.id} className="tk-ord-card">
                      <div className="tk-ord-label">Pedido de despacho #{o.num}</div>
                      <div className="tk-ord-grid">
                        <span style={{ color: 'var(--gt)' }}>Estado</span>
                        <span style={{ fontWeight: 800 }}>{STATUS_LABEL[o.status] ?? o.status}</span>
                        <span style={{ color: 'var(--gt)' }}>Total</span>
                        <span style={{ fontWeight: 800, color: 'var(--v)' }}>{fmtCOP(total)}</span>
                        <span style={{ color: 'var(--gt)' }}>Domiciliario</span>
                        <span style={{ fontWeight: 700 }}>{o.employee?.name ?? 'Sin asignar'}</span>
                        <span style={{ color: 'var(--gt)' }}>Pago</span>
                        <span style={{ fontWeight: 800, color: o.paid ? '#2E7D32' : 'var(--a)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {o.paid ? <><Check size={12} strokeWidth={3} /> Cobrado</> : 'Pendiente'}
                        </span>
                      </div>
                      {onOpenOrder && (
                        <button className="bverde" style={{ width: '100%', marginTop: 9, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={() => { onClose(); onOpenOrder(o.id); }}>
                          Ver pedido #{o.num} <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                background: 'var(--ac)', border: '2px solid #FFCC80',
                borderRadius: 'var(--rad)', padding: '14px 16px', fontSize: 14,
                color: 'var(--a)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Lock size={14} /> Este ticket aún no tiene pedido. El cliente está esperando atención.
              </div>
            )}

            <div className="mactions">
              <button className="bsec" onClick={onClose}>Cerrar</button>
              {onCreateFromTicket && (
                <button className="bpri"
                  onClick={() => { onClose(); onCreateFromTicket(ticket); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  + {hasOrders ? 'Otro pedido' : 'Crear pedido'}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {showBlockConfirm && (
        <ConfirmModal
          message="Vas a bloquear el link del formulario - el cliente no podrá usarlo y tendrás que enviarle uno nuevo. ¿Deseas bloquearlo?"
          confirmLabel="Bloquear"
          danger
          onConfirm={() => { blockLinkMut.mutate(); setShowBlockConfirm(false); }}
          onCancel={() => setShowBlockConfirm(false)}
        />
      )}

      {forwardMsg && (
        <ForwardMessageModal message={forwardMsg} currentTicketId={ticketId} onClose={() => setForwardMsg(null)} />
      )}

      {tomarListaResult && (
        <TomarListaResultModal
          unmatchedNames={tomarListaResult.unmatchedNames}
          eligibleOrders={eligibleOrders.map((o: any) => ({ id: o.id, num: o.num, status: STATUS_LABEL[o.status] ?? o.status }))}
          onConfirm={(target) => {
            const extracted = tomarListaResult.items;
            setTomarListaResult(null);
            onClose();
            if (target === 'new') onCreateFromTicket?.(ticket, extracted);
            else onOpenOrder?.(target.orderId, extracted);
          }}
          onCancel={() => setTomarListaResult(null)}
        />
      )}
    </div>
  );
}
