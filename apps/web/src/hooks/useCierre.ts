import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// `fecha` optional so callers that only know it after another query resolves
// (e.g. DetallePedidoModal, which needs the order loaded first) can pass
// undefined until then instead of juggling their own `enabled` flag.
export function useDiaCerrado(fecha?: string) {
  return useQuery({
    queryKey: ['cierre-status', fecha],
    queryFn: () => api.get<{ data: { cerrado: boolean; closedAt: string | null } }>(`/cierre/status?fecha=${fecha}`).then((r) => r.data),
    enabled: !!fecha,
  });
}
