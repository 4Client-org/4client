import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Paperclip, AlertTriangle, Pencil, CheckCircle, Forward } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { toast } from '../ui/Toast';
import { colombiaDateStr, formatChatTimestamp, formatChatDateDivider } from '../../lib/format';
import ForwardMessageModal from '../ui/ForwardMessageModal';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import DeliveryStatus from '../ui/DeliveryStatus';
import ChatImage from '../ui/ChatImage';
import ChatAudio from '../ui/ChatAudio';
import ChatVideo from '../ui/ChatVideo';
import ChatDocument from '../ui/ChatDocument';
import ChatLocation from '../ui/ChatLocation';
import { useSendChatMedia, CHAT_MEDIA_ACCEPT } from '../../hooks/useSendChatMedia';

// Backend (tickets.ts PATCH /:id) and this UI are both fully built and tested -
// hidden for now because nobody has actually asked for this yet, not because
// anything is broken. Flip to true to bring the pencil button back; nothing
// else needs to change.
const RENAME_TICKET_UI_ENABLED = false;

// Sidebar preview text for the ticket list - the real content (photo/audio/etc)
// only renders once the conversation is actually open.
const MEDIA_PREVIEW_LABEL: Record<string, string> = {
  image: 'Foto', audio: 'Audio', video: 'Video', document: 'Documento', location: 'Ubicación',
};

// Safe URL regex - no backtracking ambiguity, no ReDoS risk
const URL_RE = /(https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]{1,2000})/g;
function renderText(text: string) {
  const parts = text.split(URL_RE);
  // Reset lastIndex since split reuses the regex object
  URL_RE.lastIndex = 0;
  return parts.map((p, i) => {
    URL_RE.lastIndex = 0;
    return URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer noopener"
          style={{ color: '#1A7A4A', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p;
  });
}

// Messages only - viewing and replying. Creating/opening pedidos from a chat happens
// in "Ver conversación" (TicketModal), not here.
export default function InboxPanel() {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  // Matches the backend's own gate (tickets.ts PATCH /:id, requireRole('admin') -
  // 'dev' bypasses every requireRole check, see middleware/auth.ts).
  const isAdmin = user?.role === 'admin' || user?.role === 'dev';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [editingTicket, setEditingTicket] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // Forward-message - hoveredMsgId only drives which bubble shows its forward
  // icon (mouse-based, since .chat-bub is a plain CSS class with no built-in
  // hover-reveal slot to hook a child element into). forwardMsg holds the
  // actual message being forwarded, null when the picker modal is closed.
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<any | null>(null);

  const { data: tickets = [] } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ data: any[] }>('/inbox').then((r) => r.data),
    refetchInterval: 60000,
  });


  // Real-time: reorder sidebar + refresh open conversation on any message
  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      // Always refresh sidebar list (reorders by last_message_at)
      qc.invalidateQueries({ queryKey: ['inbox'] });
      // Refresh open conversation if it's the one that got the message
      if (data?.ticketId) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', data.ticketId] });
      }
    };
    // Order status badges shown in the sidebar and the linked-orders bar must update
    // immediately when an order moves/changes elsewhere (e.g. dragged in the swimlane),
    // not just when a new chat message happens to trigger a refetch.
    const onOrderChange = () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['inbox-convo'] });
    };
    // Delivery/read/failure updates on a message already shown - same refresh as
    // a new message.
    const onMsgStatus = (data: { ticketId: string }) => {
      if (data?.ticketId) qc.invalidateQueries({ queryKey: ['inbox-convo', data.ticketId] });
    };
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
  }, [accessToken, qc]);

  const { data: conversation, isLoading: loadingConvo } = useQuery({
    queryKey: ['inbox-convo', selectedId],
    queryFn: () =>
      selectedId
        ? api.get<{ data: any }>(`/inbox/${selectedId}/messages`).then((r) => r.data)
        : null,
    enabled: !!selectedId,
    // Fallback only - real-time delivery is via socket, but a missed/late socket event
    // (reconnect race, room not rejoined yet) shouldn't leave the open conversation stale
    // for longer than this.
    refetchInterval: 60000,
  });

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${selectedId}/reply`, { text }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', selectedId] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setReplyText('');
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado. WPP sin configurar - revisa DevTools - WPP', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  // Renames a ticket and/or corrects its associated phone number - propagates to
  // every order already linked (tickets.ts's PATCH /:id), so a full refresh of
  // orders/tickets/dashboard is needed too, not just this sidebar/conversation.
  const renameMut = useMutation({
    mutationFn: (body: { customer_name?: string; phone?: string }) => api.patch(`/tickets/${selectedId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['inbox-convo', selectedId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setEditingTicket(false);
      toast('Chat actualizado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { pickAndSend, isPending: sendMediaPending } = useSendChatMedia(selectedId ?? undefined, [['inbox-convo', selectedId], ['inbox']]);

  async function handlePickMedia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await pickAndSend(file);
  }

  // Keeps the chat pinned to the bottom, not just when a new message arrives but
  // also when an already-shown row grows AFTER that (an image finishing its async
  // load, see ChatImage) - a plain "scroll on message count change" fired too early
  // for images, leaving the bottom of the photo cut off until the person manually
  // scrolled. ResizeObserver on the inner wrapper (not the outer scroll container,
  // whose own size is fixed by its flex parent) catches both cases the same way.
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
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handler = (e: Event) => { if ((e as globalThis.KeyboardEvent).key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId]);

  // Switching chats must not leave a stale rename form open against the wrong ticket.
  useEffect(() => { setEditingTicket(false); }, [selectedId]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  function sendReply() {
    const txt = replyText.trim();
    if (!txt || replyMut.isPending) return;
    replyMut.mutate(txt);
  }

  function formatMsgTime(raw: string) {
    return formatChatTimestamp(raw);
  }

  function formatSidebarTime(raw: string) {
    const d = new Date(raw);
    if (colombiaDateStr(d) === colombiaDateStr()) {
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    }
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
  }

  const selectedTicket = tickets.find((t: any) => t.id === selectedId);

  return (
    <div className="inbox-wrap">
      {/* LEFT SIDEBAR */}
      <div className="inbox-sidebar">
        <div style={{ padding: '12px 16px', borderBottom: '2px solid var(--brd)', background: 'var(--vc)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14, color: 'var(--vd)' }}>
            <MessageSquare size={16} /> Conversaciones WPP
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 3 }}>
            {tickets.length} chat{tickets.length !== 1 ? 's' : ''} · historial completo
          </div>
        </div>

        {tickets.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--gt)', fontSize: 13 }}>
            Sin conversaciones
          </div>
        )}

        {(tickets as any[]).map((t) => {
          const lastMsg = t.messages?.[0];
          return (
            <div
              key={t.id}
              className={`inbox-item${selectedId === t.id ? ' sel' : ''}`}
              onClick={() => setSelectedId(t.id)}
            >
              <div className="inbox-item-head">
                <span className="inbox-item-name">{t.customer_name || formatPhoneDisplay(t.phone)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t.unread_count > 0 && (
                    <span className="inbox-unread">{t.unread_count}</span>
                  )}
                  <span className="inbox-item-time">
                    {/* Last activity in EITHER direction (including a staff reply),
                        not just the last inbound message - matches the list's own
                        order (inbox.ts orders by last_activity_at too). */}
                    {(t.last_activity_at ?? t.last_message_at) ? formatSidebarTime(t.last_activity_at ?? t.last_message_at) : ''}
                  </span>
                </div>
              </div>
              <div className="inbox-item-phone">{formatPhoneDisplay(t.phone)}</div>
              {lastMsg && (
                <div className="inbox-item-preview">
                  {lastMsg.direction === 'out' ? '› ' : ''}
                  {MEDIA_PREVIEW_LABEL[lastMsg.media_type as string] ?? lastMsg.text}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT CHAT PANEL */}
      {!selectedId ? (
        <div className="inbox-chat">
          <div className="inbox-empty">
            <MessageSquare size={48} color="#ccc" strokeWidth={1} />
            <div className="inbox-no-sel">Selecciona una conversación</div>
          </div>
        </div>
      ) : (
        <div className="inbox-chat">
          {/* Chat header */}
          <div className="inbox-chat-head">
            {editingTicket ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <input className="fi2" value={editName} onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nombre del cliente" maxLength={200} />
                <input className="fi2" value={editPhone} onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Teléfono (déjalo igual si no lo vas a cambiar)" maxLength={150} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="bpri" disabled={renameMut.isPending}
                    onClick={() => {
                      const body: { customer_name?: string; phone?: string } = {};
                      if (editName.trim() && editName.trim() !== selectedTicket?.customer_name) body.customer_name = editName.trim();
                      if (editPhone.trim() && editPhone.trim() !== selectedTicket?.phone) body.phone = editPhone.trim();
                      if (Object.keys(body).length === 0) { setEditingTicket(false); return; }
                      renameMut.mutate(body);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCircle size={13} /> {renameMut.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button className="bsec" onClick={() => setEditingTicket(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>
                    {selectedTicket?.customer_name || formatPhoneDisplay(selectedTicket?.phone)}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--gt)' }}>{formatPhoneDisplay(selectedTicket?.phone)}</div>
                </div>
                {RENAME_TICKET_UI_ENABLED && isAdmin && (
                  <button
                    onClick={() => {
                      setEditName(selectedTicket?.customer_name ?? '');
                      setEditPhone(selectedTicket?.phone ?? '');
                      setEditingTicket(true);
                    }}
                    title="Renombrar chat / corregir número"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', display: 'flex', alignItems: 'center', padding: 3 }}>
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {selectedTicket?.no_wpp_number && (
            <div style={{ background: 'var(--rc)', border: '1.5px solid var(--r)', borderRadius: 0, padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <AlertTriangle size={14} /> Este ticket llegó sin número de WhatsApp - no se puede responder.
            </div>
          )}

          {/* Messages */}
          <div className="inbox-messages" ref={chatScrollRef}>
           <div ref={chatInnerRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loadingConvo && (
              <div style={{ textAlign: 'center', color: '#667781', padding: 20, fontSize: 13 }}>
                Cargando mensajes...
              </div>
            )}

            {conversation?.messages?.map((msg: any, i: number) => {
              const isOut = msg.direction === 'out';
              const prevMsg = conversation.messages[i - 1];
              // Grouped by created_at (real arrival order), not sent_at - same reason
              // the message list itself sorts by created_at: a delayed webhook
              // delivery reporting an old sent_at must still land under TODAY's
              // divider, not get filed under whatever day it claims to be from.
              const showDate = !prevMsg ||
                colombiaDateStr(msg.created_at ?? msg.sent_at) !== colombiaDateStr(prevMsg.created_at ?? prevMsg.sent_at);

              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {showDate && (
                    <div className="chat-sep">
                      {formatChatDateDivider(msg.created_at ?? msg.sent_at)}
                    </div>
                  )}
                  <div className={`chat-bub ${isOut ? 'out' : 'in'}`}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId((id) => (id === msg.id ? null : id))}>
                    {isOut && (
                      <div className="chat-bub-who">{msg.sender?.name ?? 'Sistema'}</div>
                    )}
                    {msg.media_type === 'image' && <ChatImage token={msg.media_url} caption={msg.media_caption ?? msg.text} />}
                    {msg.media_type === 'audio' && <ChatAudio token={msg.media_url} />}
                    {msg.media_type === 'video' && <ChatVideo token={msg.media_url} caption={msg.media_caption ?? msg.text} />}
                    {msg.media_type === 'document' && <ChatDocument token={msg.media_url} filename={msg.media_caption} caption={msg.media_caption ? msg.text : null} />}
                    {msg.media_type === 'location' && <ChatLocation url={msg.media_url} label={msg.text} />}
                    {!msg.media_type && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(msg.text)}</div>}
                    <div className="chat-bub-time" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      {formatMsgTime(msg.sent_at)}
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
              );
            })}
           </div>
          </div>

          {/* Reply bar */}
          <div className="inbox-reply">
            <input ref={fileInputRef} type="file" accept={CHAT_MEDIA_ACCEPT} onChange={handlePickMedia} style={{ display: 'none' }} />
            <button
              title="Adjuntar foto, audio, video o documento"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMediaPending}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', padding: '0 6px', display: 'flex', alignItems: 'center' }}
            >
              <Paperclip size={19} />
            </button>
            <textarea
              placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para salto)"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button className="send-btn" onClick={sendReply} disabled={!replyText.trim() || replyMut.isPending}>
              <Send size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />
              {' '}Enviar
            </button>
          </div>
        </div>
      )}

      {forwardMsg && selectedId && (
        <ForwardMessageModal message={forwardMsg} currentTicketId={selectedId} onClose={() => setForwardMsg(null)} />
      )}
    </div>
  );
}
