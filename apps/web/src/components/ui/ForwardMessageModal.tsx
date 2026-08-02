import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from './Toast';
import { normalizeSearch } from '../../lib/normalize';
import { formatPhoneDisplay } from '../../lib/formatPhone';

interface Props {
  message: { id: string };
  currentTicketId: string;
  onClose: () => void;
}

// Shared by every chat view that can show a message (InboxPanel's own
// conversation, TicketModal "Ver conversación", DetallePedidoModal's embedded
// chat) - one modal instead of duplicating this three times. Always fetches
// the ['inbox'] ticket list itself (same query key InboxPanel/MainPage use,
// so React Query just reuses whatever's already cached there instead of a
// fresh network call in the common case).
export default function ForwardMessageModal({ message, currentTicketId, onClose }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: tickets = [] } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ data: any[] }>('/inbox').then((r) => r.data),
  });

  const forwardMut = useMutation({
    mutationFn: (targetTicketIds: string[]) =>
      api.post<{ data: { forwarded: number; failed: string[] } }>(`/inbox/messages/${message.id}/forward`, { targetTicketIds }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      toast(`Reenviado a ${res.data.forwarded} chat${res.data.forwarded === 1 ? '' : 's'}`);
      onClose();
    },
    onError: (e: any) => toast(e.message, true),
  });

  return (
    <div className="moverlay on" style={{ zIndex: 950 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin" style={{ maxWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="mbody" style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Reenviar a...</div>
          <input
            className="fi2"
            placeholder="Buscar chat..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 10 }}
            autoFocus
          />
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, border: '1px solid var(--brd)', borderRadius: 8 }}>
            {tickets
              .filter((t: any) => t.id !== currentTicketId)
              .filter((t: any) => {
                const q = normalizeSearch(search);
                if (!q) return true;
                return normalizeSearch(t.customer_name ?? '').includes(q) || (t.phone ?? '').includes(search);
              })
              .map((t: any) => {
                const checked = selected.has(t.id);
                return (
                  <label key={t.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--brd)', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setSelected((prev) => {
                        const next = new Set(prev);
                        checked ? next.delete(t.id) : next.add(t.id);
                        return next;
                      })} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{t.customer_name || formatPhoneDisplay(t.phone)}</div>
                      <div style={{ color: 'var(--gt)', fontSize: 12 }}>{formatPhoneDisplay(t.phone)}</div>
                    </div>
                  </label>
                );
              })}
          </div>
          <div className="mactions" style={{ marginTop: 14 }}>
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bpri"
              disabled={selected.size === 0 || forwardMut.isPending}
              onClick={() => forwardMut.mutate([...selected])}>
              {forwardMut.isPending ? 'Reenviando...' : <><CheckCircle size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />Reenviar a ({selected.size})</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
