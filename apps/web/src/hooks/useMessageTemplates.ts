import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { getSocket } from '../lib/socket';

export type MessageTemplates = {
  form_warning: string;
  form_followup: string;
  bank_account: string;
};

// Textos que la org configuró (Configuración > Mensajes) para los botones del
// chat. Se piden al servidor en vez de tenerlos fijos en el front, así un cambio
// del admin aplica sin desplegar nada.
export function useMessageTemplates() {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  // Sin esto, una sesión que ya tenía los textos en caché (staleTime 5 min)
  // seguía mandando el texto viejo al cliente hasta que esa caché expirara
  // sola - un cambio guardado en Configuración > Mensajes en OTRA pestaña o
  // dispositivo no se veía reflejado al enviar el formulario hasta 5 minutos
  // después. Mismo patrón que product:changed (useProducts.ts).
  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onChanged = () => qc.invalidateQueries({ queryKey: ['message-templates'] });
    sock.on('message-templates:changed', onChanged);
    return () => { sock.off('message-templates:changed', onChanged); };
  }, [accessToken, qc]);

  return useQuery({
    queryKey: ['message-templates'],
    queryFn: () => api.get<{ data: { templates: MessageTemplates } }>('/config/message-templates').then(r => r.data.templates),
    staleTime: 5 * 60_000,
  });
}
