import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useRef, useEffect, useState, KeyboardEvent, ChangeEvent } from 'react';
import { Check, SendHorizontal, ArrowRight, Lock, ClipboardList, Ban, Paperclip } from 'lucide-react';
import DeliveryStatus from '../ui/DeliveryStatus';
import ChatImage from '../ui/ChatImage';
import { fileToBase64, CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MIME_TYPES } from '../../lib/fileToBase64';
import { api } from '../../lib/api';
import { buildFormLinkWarningMessage, buildFormLinkFollowUpMessage } from '../../lib/formLinkMessage';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { fmtCOP, STATUS_LABEL, todayStr, formatChatTimestamp, formatChatDateDivider, colombiaDateStr } from '../../lib/format';
import { useDiaCerrado } from '../../hooks/useCierre';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';

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
  onCreateFromTicket?: (ticket: any) => void;
  onOpenOrder?: (orderId: string) => void;
}

export default function TicketModal({ ticketId, fecha, onClose, onCreateFromTicket, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [reply, setReply] = useState('');
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
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
  const sendImageMut = useMutation({
    mutationFn: (payload: { data: string; mime_type: string }) =>
      api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${ticketId}/send-image`, payload),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      if (res?.wpp_status === 'failed') {
        toast(`Foto guardada pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Foto guardada, pero este negocio no tiene WhatsApp conectado', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function handlePickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!CHAT_IMAGE_MIME_TYPES.includes(file.type)) { toast('Solo se pueden enviar fotos JPG, PNG o WEBP', true); return; }
    if (file.size > CHAT_IMAGE_MAX_BYTES) { toast('La foto pesa más de 5 MB', true); return; }
    const data = await fileToBase64(file);
    sendImageMut.mutate({ data, mime_type: file.type });
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
  // The link itself already expires (24h from issuance, or 4h if never opened - see
  // formLink.ts) - viewing a past day's chat here means whatever link was ever sent
  // for it is very likely already dead, so sending/blocking one from this stale view
  // can only confuse ("bloqueado" a link that already expired, or a fresh link
  // that's really meant for TODAY's conversation, not the day being read). Also true
  // the moment TODAY's caja gets closed early (cierre.ts only allows closing today),
  // same as a past day for this purpose.
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const isPastDay = fecha < todayStr() || (cierreStatus?.cerrado ?? false);

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row',
        width: '100%', maxWidth: 860,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease', maxHeight: '90vh',
      }}>

        {/* ===== LEFT: CHAT ===== */}
        <div style={{
          width: 310, background: '#ECE5DD', display: 'flex',
          flexDirection: 'column', flexShrink: 0, minHeight: 0,
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
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
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
            </div>
          </div>

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
                <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    background: isOut ? '#DCF8C6' : '#fff',
                    borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '7px 10px', maxWidth: '85%', fontSize: 12,
                    boxShadow: '0 1px 2px rgba(0,0,0,.1)',
                  }}>
                    {isOut && msg.sender?.name && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--vd)', marginBottom: 2 }}>{msg.sender.name}</div>
                    )}
                    {msg.media_type === 'image'
                      ? <ChatImage token={msg.media_url} caption={msg.media_caption ?? msg.text} />
                      : <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(msg.text)}</div>}
                    <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      {formatChatTimestamp(msg.sent_at)}
                      {isOut && msg.wpp_message_id && (
                        <DeliveryStatus delivered={msg.delivered} read_by_client={msg.read_by_client} failed_reason={msg.failed_reason} />
                      )}
                    </div>
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

          {/* Reply bar */}
          <div style={{
            background: '#F0F2F0', padding: '8px 10px',
            display: 'flex', gap: 6, alignItems: 'flex-end',
            borderTop: '1px solid #D0D8D0', flexShrink: 0,
          }}>
            <input ref={fileInputRef} type="file" accept={CHAT_IMAGE_MIME_TYPES.join(',')} onChange={handlePickImage} style={{ display: 'none' }} />
            <button
              title="Adjuntar foto"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendImageMut.isPending}
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
    </div>
  );
}
