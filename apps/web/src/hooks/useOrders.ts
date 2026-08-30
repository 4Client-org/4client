import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useOrders(fecha: string) {
  return useQuery({
    queryKey: ['orders', fecha],
    queryFn: () => api.get<{ data: any[] }>(`/orders?fecha=${fecha}`).then((r) => r.data),
  });
}

// The global QueryClient default is staleTime: 30_000 (main.tsx) - TicketModal's
// own query (['ticket', ticketId, fecha], see TicketModal.tsx) caches the
// ticket's order list separately from the board's ['orders', fecha] list, and
// none of the mutations below used to touch it. Reopening a ticket within 30s
// of creating/editing/moving/collecting on one of its orders (very easy to do
// right after "Tomar lista" - the whole extract-review-save cycle can finish
// in well under 30s) showed the stale pre-mutation order list, looking like
// the order had never been saved at all. Every mutation that can change what
// a ticket's order list looks like now also invalidates ['ticket'] - a
// react-query key-prefix match, so it hits every ticket+fecha combination
// without needing to know which one is relevant here.
function invalidateTicketToo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['ticket'] });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post<{ data: any }>('/orders', body).then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders', vars.fecha] });
      qc.invalidateQueries({ queryKey: ['tickets'] }); // re-link order into ticket row immediately
      invalidateTicketToo(qc);
    },
  });
}

export function usePatchOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch<{ data: any }>(`/orders/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      invalidateTicketToo(qc);
    },
  });
}

export function useMoveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch<{ data: any }>(`/orders/${id}/status`, { status }).then((r) => r.data),
    // Optimistic update: apply the new status to the cached list immediately so the
    // card jumps columns on drop instead of waiting for a full round-trip + refetch
    // (which is what made moving an order feel ~2s slow).
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['orders'] });
      const previous = qc.getQueriesData({ queryKey: ['orders'] });
      qc.setQueriesData({ queryKey: ['orders'] }, (old: any) =>
        Array.isArray(old)
          ? old.map((o: any) => (o.id === id ? { ...o, status } : o))
          : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]: any) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      invalidateTicketToo(qc);
    },
  });
}

export function useCobroOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => api.post<{ data: any }>(`/orders/${id}/cobro`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      invalidateTicketToo(qc);
    },
  });
}
