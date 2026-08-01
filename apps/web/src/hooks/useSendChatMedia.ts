import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/ui/Toast';
import { fileToBase64 } from '../lib/fileToBase64';

// One entry per outbound media route in inbox.ts - mirrors those routes' own
// mime allow-lists/size caps exactly (server-side is still the real gate, this
// is just so a bad pick fails fast with a clear message instead of a round trip).
const MEDIA_KINDS: Array<{
  kind: 'image' | 'audio' | 'video' | 'document';
  mimeTypes: string[];
  maxBytes: number;
  endpoint: string;
}> = [
  { kind: 'image', mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1024 * 1024, endpoint: 'send-image' },
  { kind: 'audio', mimeTypes: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr'], maxBytes: 16 * 1024 * 1024, endpoint: 'send-audio' },
  { kind: 'video', mimeTypes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024, endpoint: 'send-video' },
  { kind: 'document', mimeTypes: ['application/pdf'], maxBytes: 100 * 1024 * 1024, endpoint: 'send-document' },
];

// The <input type="file" accept="..."> value covering every supported type at
// once - one picker/button for all of them, not one per media kind.
export const CHAT_MEDIA_ACCEPT = MEDIA_KINDS.flatMap((k) => k.mimeTypes).join(',');

const KIND_LABEL: Record<string, string> = { image: 'foto', audio: 'audio', video: 'video', document: 'documento' };

// Shared by every chat view's "adjuntar" button (InboxPanel/TicketModal/
// DetallePedidoModal/NuevoPedidoModal) - one file picker routes to whichever of
// inbox.ts's 4 send-X routes actually matches what got picked, instead of each
// view needing its own picker button per media type.
export function useSendChatMedia(ticketId: string | undefined, invalidateKeys: unknown[][]) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: { endpoint: string; data: string; mime_type: string; filename?: string }) =>
      api.post<{ data: any; wpp_status: string; wpp_error?: string }>(
        `/inbox/${ticketId}/${payload.endpoint}`,
        { data: payload.data, mime_type: payload.mime_type, ...(payload.filename ? { filename: payload.filename } : {}) },
      ),
    onSuccess: (res: any) => {
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      if (res?.wpp_status === 'failed') {
        toast(`Guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Guardado. WPP sin configurar - revisa DevTools - WPP', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function pickAndSend(file: File) {
    if (!ticketId) return;
    const match = MEDIA_KINDS.find((k) => k.mimeTypes.includes(file.type));
    if (!match) {
      toast('Tipo de archivo no soportado (foto JPG/PNG/WEBP, audio, video MP4 o PDF)', true);
      return;
    }
    if (file.size > match.maxBytes) {
      toast(`El ${KIND_LABEL[match.kind]} pesa más de ${Math.round(match.maxBytes / (1024 * 1024))} MB`, true);
      return;
    }
    const data = await fileToBase64(file);
    mutation.mutate({ endpoint: match.endpoint, data, mime_type: file.type, filename: match.kind === 'document' ? file.name : undefined });
  }

  return { pickAndSend, isPending: mutation.isPending };
}
