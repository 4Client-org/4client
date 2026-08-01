import { useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { resolveApiBase } from '../../lib/apiBase';

const API = resolveApiBase();

// Unlike image/audio/video, a document isn't fetched eagerly on mount - a PDF can
// be much larger (100MB cap vs 5-16MB for the others) and staff may never open
// most of them, just see the filename go by in the chat. Fetched on click instead,
// straight into a new tab (the GET /media/:token route already sets
// Content-Disposition: inline, so the browser's own PDF viewer renders it there).
export default function ChatDocument({ token, filename, caption }: { token: string; filename?: string | null; caption?: string | null }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${API}/api/v1/inbox/media/${token}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
      // Revoked after a short delay, not immediately - the new tab needs the URL
      // to actually still be alive by the time it finishes opening/rendering it.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={open}
        disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.05)',
          border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, padding: '8px 12px',
          cursor: loading ? 'default' : 'pointer', maxWidth: 220, textAlign: 'left',
        }}
      >
        <FileText size={20} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {filename || 'Documento'}
        </span>
        <Download size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>
      {failed && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>No se pudo abrir el documento</div>}
      {caption && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{caption}</div>}
    </div>
  );
}
