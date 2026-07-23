import { useState, useEffect } from 'react';
import { Lock, XCircle } from 'lucide-react';
import { resolveApiBase } from '../lib/apiBase';

const API = resolveApiBase();
const GREEN = '#1A7A4A';

// Shared over WhatsApp exactly like a form link, so it gets the same protection:
// a phone_last4 gate (ClientFormPage's 'verify' screen, same idea) before the PDF
// itself is ever fetched - see files.ts's GET /:filename.
export default function FacturaPage() {
  const filename = new URLSearchParams(window.location.search).get('f') ?? '';

  // 'loading' while GET /:filename/status runs - a blocked/expired factura goes
  // straight to 'error' from there, never showing the digit-entry screen at all
  // (matches ClientFormPage: typing 4 digits into a link that was already dead is
  // pointless and just delays telling the visitor it's dead).
  const [state, setState] = useState<'loading' | 'verify' | 'error'>('loading');
  const [phoneInput, setPhoneInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!filename) { setState('error'); setErrorMsg('Link inválido.'); return; }
    fetch(`${API}/api/v1/files/${encodeURIComponent(filename)}/status`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setState('error'); setErrorMsg(body.error ?? 'Este link ya no es válido.'); return; }
        setState('verify');
      })
      .catch(() => { setState('error'); setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.'); });
  }, [filename]);

  async function handleVerify() {
    const last4 = phoneInput.trim();
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) {
      setErrorMsg('Escribe los 4 dígitos.');
      return;
    }
    setVerifying(true);
    setErrorMsg('');
    const fileUrl = `${API}/api/v1/files/${encodeURIComponent(filename)}?phone_last4=${encodeURIComponent(last4)}`;
    try {
      // A HEAD-ish check first (via GET, cheapest reliable option) just to catch a
      // wrong/dead link with a proper message - on success we hand off to a real
      // navigation instead of rendering the PDF ourselves, so the browser's own
      // native PDF viewer takes over exactly like tapping the old, unprotected link
      // used to: full-screen, no download button bolted on, nothing to render badly
      // inside a restrictive in-app browser's iframe/blob support.
      const res = await fetch(fileUrl);
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string; code?: string }));
        if (err.code === 'PHONE_MISMATCH') {
          setErrorMsg(err.error ?? 'Número incorrecto. Verifica los últimos 4 dígitos.');
        } else {
          setState('error');
          setErrorMsg(err.error ?? 'Este link ya no es válido.');
        }
        return;
      }
      window.location.replace(fileUrl);
    } catch {
      setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.');
    } finally {
      setVerifying(false);
    }
  }

  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f0f4f8',
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', fontSize: 17, fontWeight: 800, padding: '15px 0', background: GREEN, color: '#fff',
    border: 'none', borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  };

  if (state === 'loading') return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  // Same exact layout/copy-shape as ClientFormPage's 'invalid' screen (icon, heading,
  // message) - a blocked/expired/dead link should look and read the same way
  // whether it's a form link or a factura link, not like two different features.
  if (state === 'error') return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><XCircle size={56} color="#DC2626" strokeWidth={1.5} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Link inválido</div>
        <div style={{ fontSize: 15, color: '#666' }}>{errorMsg}</div>
      </div>
    </div>
  );

  return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><Lock size={48} color={GREEN} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 8, textAlign: 'center' }}>Confirma que eres tú</div>
        <div style={{ fontSize: 14, color: '#666', marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>
          Escribe los últimos 4 dígitos del número de WhatsApp donde recibiste este link para ver tu factura.
        </div>
        <input
          type="tel" inputMode="numeric" maxLength={4} autoFocus
          placeholder="0000"
          value={phoneInput}
          onChange={(e) => { setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 4)); if (errorMsg) setErrorMsg(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
          style={{
            width: '100%', fontSize: 28, fontWeight: 800, letterSpacing: 10, textAlign: 'center',
            padding: '14px 0', border: `2px solid ${errorMsg ? '#DC2626' : '#ddd'}`, borderRadius: 12,
            outline: 'none', marginBottom: 10, color: '#111',
          }}
        />
        {errorMsg && <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>{errorMsg}</div>}
        <button onClick={handleVerify} disabled={verifying} style={{ ...btnPrimary, opacity: verifying ? 0.6 : 1 }}>
          {verifying ? 'Verificando...' : 'Ver factura'}
        </button>
      </div>
    </div>
  );
}
