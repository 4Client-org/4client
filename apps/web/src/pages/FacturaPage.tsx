import { useState, useEffect } from 'react';
import { XCircle } from 'lucide-react';
import { resolveApiBase } from '../lib/apiBase';

const API = resolveApiBase();

// Shared over WhatsApp exactly like a form link - the unguessable, signed filename
// itself (backed by files.ts's GET /:filename/status + /:filename, with its own
// TTL/revocation) is the whole gate now, no phone digits involved.
export default function FacturaPage() {
  const filename = new URLSearchParams(window.location.search).get('f') ?? '';

  const [state, setState] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!filename) { setState('error'); setErrorMsg('Link inválido.'); return; }
    fetch(`${API}/api/v1/files/${encodeURIComponent(filename)}/status`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setState('error'); setErrorMsg(body.error ?? 'Este link ya no es válido.'); return; }
        // Hand off to a real navigation so the browser's own native PDF viewer takes
        // over: full-screen, no download button bolted on, nothing to render badly
        // inside a restrictive in-app browser's iframe/blob support.
        window.location.replace(`${API}/api/v1/files/${encodeURIComponent(filename)}`);
      })
      .catch(() => { setState('error'); setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.'); });
  }, [filename]);

  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f0f4f8',
  };

  if (state === 'loading') return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  // Same exact layout/copy-shape as ClientFormPage's 'invalid' screen (icon, heading,
  // message) - a blocked/expired/dead link should look and read the same way
  // whether it's a form link or a factura link, not like two different features.
  return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><XCircle size={56} color="#DC2626" strokeWidth={1.5} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Link inválido</div>
        <div style={{ fontSize: 15, color: '#666' }}>{errorMsg}</div>
      </div>
    </div>
  );
}
