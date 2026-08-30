import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

// "Tomar lista": staff toggles a selection mode over the chat, checks off the
// customer's own text messages that describe their order, and sends them to
// POST /inbox/:ticketId/parse-messages for AI extraction+catalog matching.
// Shared by TicketModal, NuevoPedidoModal and DetallePedidoModal - each has its
// own message-list JSX (two different rendering patterns), but the selection
// state/mutation logic is identical across all three.

export interface ChatMessageLike {
  id?: string;
  direction?: string;
  media_type?: string | null;
}

export interface TomarListaItem {
  product_name: string;
  quantity_label: string;
  price: number;
  added_by_client: boolean;
  ai_unmatched: boolean;
}

interface ParseMessagesResponse {
  data: { items: TomarListaItem[]; unmatchedNames: string[] };
}

export function useTomarLista(ticketId: string | undefined | null) {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback(() => {
    setActive(a => !a);
    setSelectedIds(new Set());
  }, []);

  const clear = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  // Unlike clear() above, stays IN selection mode - for "me equivoqué,
  // deselecciono todo" without having to re-click "Tomar lista" to start over.
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleMsg = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Only the customer's own plain-text messages are ever selectable - never a
  // staff reply, never a media message (nothing for the AI to read there).
  const isEligible = useCallback((m: ChatMessageLike) => !m.media_type && m.direction !== 'out', []);

  const mutation = useMutation({
    mutationFn: () => api.post<ParseMessagesResponse>(`/inbox/${ticketId}/parse-messages`, {
      messageIds: Array.from(selectedIds),
    }),
  });

  return { active, toggle, clear, clearSelection, selectedIds, toggleMsg, isEligible, mutation };
}
