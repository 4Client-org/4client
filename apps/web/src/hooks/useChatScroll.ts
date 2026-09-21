import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../components/ui/Toast';

// Shared by every place a WhatsApp conversation gets rendered (InboxPanel's
// main Chats WPP panel, TicketModal, NuevoPedidoModal, DetallePedidoModal) -
// all four used to duplicate their own copy of this exact scroll/pagination
// logic. Centralized here so a fix (or a new feature, like this one) lands
// everywhere the chat is visible at once, instead of needing four separate
// patches that inevitably drift out of sync with each other.
//
// `baseMessages` is whatever the caller's own useQuery already returns for
// the most-recent-500 window (GET /inbox/:id/messages) - this hook only adds
// older-history pagination on top and never touches that query itself, since
// each caller's query shape/key differs slightly (TicketModal adds a `fecha`
// param, DetallePedidoModal derives ticketId from `order?.ticket_id`, etc).
export function useChatScroll(ticketId: string | null | undefined, baseMessages: any[], initialHasMore: boolean) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInnerRef = useRef<HTMLDivElement>(null);
  // Empty div the caller renders as the very last child inside chatInnerRef,
  // after the last message - scrollIntoView on THIS element is what actually
  // guarantees the newest message is fully visible. Doing it by computing
  // `scrollTop = scrollHeight` instead (the previous approach) could land a
  // few pixels short of true bottom - fractional/rounded heights from images,
  // the message-gap CSS, etc. all added up to sometimes leaving the last
  // bubble's very bottom edge just outside the visible area.
  const bottomRef = useRef<HTMLDivElement>(null);

  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Set right before prepending older messages to the scroll container's
  // height at that instant - lets the very next resize tick preserve the
  // person's spot in the conversation instead of the usual "stick to bottom"
  // behavior, which would otherwise yank them all the way down to the newest
  // message the moment 100+ older rows get added above what they were reading.
  const preserveScrollHeightRef = useRef<number | null>(null);
  // Read continuously from a real scroll listener (below), not recomputed
  // inside the ResizeObserver's own callback - by the time that callback
  // fires, the container has already grown, so "was the person at the bottom"
  // has to be known from BEFORE the content changed, not after.
  const wasNearBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const lastMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    setOlderMessages([]);
    lastMsgIdRef.current = null;
    setNewMessageCount(0);
    setShowJumpToBottom(false);
    // Opening (or re-opening) a chat must always land at the newest message,
    // never wherever the scroll happened to be left (own chat re-opened, or
    // the outer scroll container reused for a DIFFERENT ticket entirely - see
    // InboxPanel, whose .inbox-messages div never unmounts between chats).
    // Forced here, before the scroll-position effect below gets a chance to
    // read the container's still-stale scrollTop/scrollHeight from whatever
    // chat was open a moment ago and misjudge "not near bottom" from it.
    wasNearBottomRef.current = true;
    preserveScrollHeightRef.current = null;
  }, [ticketId]);

  useEffect(() => {
    setHasMoreMessages(!!initialHasMore);
  }, [ticketId, initialHasMore]);

  useEffect(() => {
    const outer = chatScrollRef.current;
    if (!outer) return;
    const onScroll = () => {
      const nearBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight < 80;
      wasNearBottomRef.current = nearBottom;
      setShowJumpToBottom(!nearBottom);
      if (nearBottom) setNewMessageCount(0);
    };
    // No initial call here on purpose - on a ticket switch the container's
    // scrollTop/scrollHeight still belong to whatever chat was open a moment
    // ago (this div is reused, not remounted, e.g. InboxPanel switching chats),
    // so measuring "near bottom" right now would judge the NEW chat by the OLD
    // chat's leftover scroll position. wasNearBottomRef is already forced true
    // by the ticket-reset effect above; this listener only needs to react to
    // the person's own real scrolling from here on.
    outer.addEventListener('scroll', onScroll);
    return () => outer.removeEventListener('scroll', onScroll);
  }, [ticketId]);

  const allMessages = [...olderMessages, ...baseMessages];

  // Counts a genuinely NEW message landing at the end of the conversation
  // (arrived or just sent) while the person is scrolled up reading older
  // history - same "🔽 N mensajes nuevos" idea WhatsApp itself shows, instead
  // of silently doing nothing until they happen to scroll down themselves.
  // Keyed off the last message's own id changing, not the array length, so
  // loading OLDER history (which changes length too, at the other end) never
  // counts as a "new" message here.
  useEffect(() => {
    const last = allMessages[allMessages.length - 1];
    if (last && lastMsgIdRef.current !== null && last.id !== lastMsgIdRef.current && !wasNearBottomRef.current) {
      setNewMessageCount((n) => n + 1);
    }
    if (last) lastMsgIdRef.current = last.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages[allMessages.length - 1]?.id]);

  useEffect(() => {
    const outer = chatScrollRef.current;
    const inner = chatInnerRef.current;
    if (!outer || !inner) return;
    const stick = () => {
      if (preserveScrollHeightRef.current !== null) {
        outer.scrollTop = outer.scrollHeight - preserveScrollHeightRef.current;
        preserveScrollHeightRef.current = null;
        return;
      }
      // Only auto-follow to the bottom if the person was already down there -
      // a message arriving (or being sent) while they're scrolled up reading
      // history must never yank them away from what they're looking at; the
      // jump-to-bottom button + new-message counter are how they get back
      // down on their own terms instead.
      if (wasNearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [ticketId]);

  async function loadOlderMessages() {
    const cursor = allMessages[0]?.id;
    if (!ticketId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.get<{ data: { messages: any[]; hasMoreMessages: boolean } }>(
        `/inbox/${ticketId}/messages/older?cursor=${cursor}`,
      );
      preserveScrollHeightRef.current = chatScrollRef.current?.scrollHeight ?? null;
      setOlderMessages((prev) => [...res.data.messages, ...prev]);
      setHasMoreMessages(res.data.hasMoreMessages);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setLoadingOlder(false);
    }
  }

  function jumpToBottom() {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    setNewMessageCount(0);
  }

  return {
    chatScrollRef, chatInnerRef, bottomRef, allMessages,
    hasMoreMessages, loadingOlder, loadOlderMessages,
    showJumpToBottom, newMessageCount, jumpToBottom,
  };
}
