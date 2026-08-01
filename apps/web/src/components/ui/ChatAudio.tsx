import { useChatMediaBlob } from '../../hooks/useChatMediaBlob';

// WhatsApp audio messages never carry a caption (see meta-cloud.ts's sendAudio) -
// nothing to render here beyond the player itself.
export default function ChatAudio({ token }: { token: string }) {
  const { src, failed } = useChatMediaBlob(token);

  if (failed) {
    return <div style={{ fontSize: 12, color: '#DC2626', padding: '8px 0' }}>No se pudo cargar el audio</div>;
  }
  if (!src) {
    return <div style={{ fontSize: 11, color: '#888', padding: '8px 0' }}>Cargando audio...</div>;
  }
  return <audio controls src={src} style={{ maxWidth: 240, height: 36 }} />;
}
