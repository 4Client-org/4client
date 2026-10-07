import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type MessageTemplates = {
  form_warning: string;
  form_followup: string;
  bank_account: string;
};

// Textos que la org configuró (Configuración > Mensajes) para los botones del
// chat. Se piden al servidor en vez de tenerlos fijos en el front, así un cambio
// del admin aplica sin desplegar nada.
export function useMessageTemplates() {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: () => api.get<{ data: { templates: MessageTemplates } }>('/config/message-templates').then(r => r.data.templates),
    staleTime: 5 * 60_000,
  });
}
