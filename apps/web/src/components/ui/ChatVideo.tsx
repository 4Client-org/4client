import { useChatMediaBlob } from '../../hooks/useChatMediaBlob';

export default function ChatVideo({ token, caption }: { token: string; caption?: string | null }) {
  const { src, failed } = useChatMediaBlob(token);

  if (failed) {
    return <div style={{ fontSize: 12, color: '#DC2626', padding: '8px 0' }}>No se pudo cargar el video</div>;
  }
  return (
    <div>
      {src
        ? <video controls src={src} style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block' }} />
        : (
          <div style={{ width: 160, height: 120, borderRadius: 8, background: 'rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#888' }}>
            Cargando video...
          </div>
        )}
      {caption && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{caption}</div>}
    </div>
  );
}
