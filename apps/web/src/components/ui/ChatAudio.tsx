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
  // `maxWidth` alone doesn't reliably constrain the browser's native audio
  // widget - some browsers (per the bug report: the player was visibly wider
  // than its own chat bubble, bleeding past the bubble's edge) render it at an
  // intrinsic width regardless of a max-width-only style. An explicit `width`
  // plus `display: block` (the element defaults to inline, which can also let
  // it ignore sizing in a flex/inline context) forces it to actually respect
  // this size instead of just capping it.
  return <audio controls src={src} style={{ width: 240, maxWidth: '100%', height: 36, display: 'block' }} />;
}
