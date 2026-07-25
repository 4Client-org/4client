import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { resolveApiBase } from '../../lib/apiBase';

const API = resolveApiBase();

// A chat photo is served through our own staff-authenticated route (see
// inbox.ts's GET /media/:token), not a public URL - a plain <img src> can't carry
// a bearer header, so this fetches the bytes itself and hands the browser a
// short-lived local object URL instead. Shared by every chat view (InboxPanel,
// TicketModal, DetallePedidoModal) so this fetch/revoke/error handling lives once.
export default function ChatImage({ token, caption }: { token: string; caption?: string | null }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);

    fetch(`${API}/api/v1/inbox/media/${token}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
      .then((res) => { if (!res.ok) throw new Error('fetch failed'); return res.blob(); })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, accessToken]);

  if (failed) {
    return (
      <div style={{ fontSize: 12, color: '#DC2626', padding: '8px 0' }}>
        No se pudo cargar la imagen
      </div>
    );
  }

  return (
    <div>
      {src
        ? (
          <img
            src={src}
            alt={caption ?? 'Foto'}
            onClick={() => setZoomed(true)}
            style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block', cursor: 'zoom-in', objectFit: 'cover' }}
          />
        )
        : (
          <div style={{ width: 160, height: 120, borderRadius: 8, background: 'rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#888' }}>
            Cargando...
          </div>
        )}
      {caption && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{caption}</div>}
      {/* Full-size view as an in-app overlay, not a new tab - `src` is a local
          blob: URL (see the fetch effect above), which only stays valid while
          THIS component is mounted, so keeping it in-page (instead of handing it
          to a new browser tab/window) is not just a UX preference, it's required -
          a new tab has no guarantee this component (and its URL.revokeObjectURL
          cleanup) outlives it. position:fixed overlays correctly regardless of
          how deeply this is nested inside the order/ticket modal underneath. */}
      {zoomed && src && (
        <div
          onClick={() => setZoomed(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}
        >
          <button
            onClick={() => setZoomed(false)}
            title="Cerrar"
            style={{
              position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none',
              borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
          <img
            src={src}
            alt={caption ?? 'Foto'}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain', cursor: 'default' }}
          />
        </div>
      )}
    </div>
  );
}
