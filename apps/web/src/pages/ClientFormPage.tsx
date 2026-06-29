import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

export default function ClientFormPage() {
  const slug = new URLSearchParams(window.location.search).get('org') ?? '';
  const [orgName, setOrgName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) { setNotFound(true); return; }
    fetch(`${API}/api/v1/public/org/${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(r => {
        if (r.data?.name) setOrgName(r.data.name);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { setError('Por favor ingresa tu nombre'); return; }
    if (!telefono.trim()) { setError('Por favor ingresa tu número de WhatsApp'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/public/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_slug: slug, customer_name: nombre.trim(), phone: telefono.trim() }),
      });
      if (!res.ok) throw new Error('Error al registrar');
      setDone(true);
    } catch {
      setError('Hubo un problema. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  const styles: Record<string, React.CSSProperties> = {
    page: {
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)',
      padding: '24px 16px', fontFamily: 'system-ui, sans-serif',
    },
    card: {
      background: '#fff', borderRadius: 24, boxShadow: '0 8px 40px rgba(0,0,0,.12)',
      padding: '40px 32px', width: '100%', maxWidth: 440,
    },
    logo: {
      fontSize: 42, marginBottom: 8, textAlign: 'center' as const,
    },
    orgName: {
      fontSize: 26, fontWeight: 800, textAlign: 'center' as const,
      color: '#1A7A4A', marginBottom: 6,
    },
    subtitle: {
      fontSize: 16, textAlign: 'center' as const,
      color: '#666', marginBottom: 36,
    },
    label: {
      display: 'block', fontSize: 18, fontWeight: 700,
      color: '#333', marginBottom: 8,
    },
    input: {
      width: '100%', fontSize: 22, padding: '16px 18px',
      border: '2.5px solid #ddd', borderRadius: 14,
      outline: 'none', boxSizing: 'border-box' as const,
      fontFamily: 'inherit', color: '#111',
      transition: 'border-color .15s',
    },
    group: { marginBottom: 24 },
    btn: {
      width: '100%', fontSize: 22, fontWeight: 800,
      padding: '18px 0', background: '#1A7A4A', color: '#fff',
      border: 'none', borderRadius: 14, cursor: 'pointer',
      marginTop: 8, transition: 'background .15s',
    },
    error: {
      color: '#DC2626', fontSize: 16, fontWeight: 600,
      textAlign: 'center' as const, marginTop: 16,
    },
    success: {
      textAlign: 'center' as const,
    },
    checkmark: {
      fontSize: 72, marginBottom: 16,
    },
    successTitle: {
      fontSize: 26, fontWeight: 800, color: '#1A7A4A', marginBottom: 10,
    },
    successMsg: {
      fontSize: 18, color: '#444', lineHeight: 1.5,
    },
  };

  if (notFound) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', color: '#DC2626', fontSize: 18, fontWeight: 700 }}>
            Enlace inválido. Pide un nuevo enlace al negocio.
          </div>
        </div>
      </div>
    );
  }

  if (!orgName) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', color: '#888', fontSize: 18 }}>Cargando...</div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.success}>
            <div style={styles.checkmark}>✅</div>
            <div style={styles.successTitle}>¡Registrado!</div>
            <div style={styles.successMsg}>
              Tu información fue enviada a <strong>{orgName}</strong>.<br />
              En breve serás atendido.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>🛒</div>
        <div style={styles.orgName}>{orgName}</div>
        <div style={styles.subtitle}>Envía tus datos para que podamos atenderte</div>

        <form onSubmit={handleSubmit} autoComplete="on">
          <div style={styles.group}>
            <label style={styles.label} htmlFor="nombre">Tu nombre completo</label>
            <input
              id="nombre"
              style={styles.input}
              type="text"
              placeholder="Ej: María González"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              autoComplete="name"
              autoFocus
            />
          </div>
          <div style={styles.group}>
            <label style={styles.label} htmlFor="telefono">Tu número de WhatsApp</label>
            <input
              id="telefono"
              style={styles.input}
              type="tel"
              placeholder="Ej: 3001234567"
              value={telefono}
              onChange={e => setTelefono(e.target.value)}
              autoComplete="tel"
              inputMode="numeric"
            />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button
            type="submit"
            style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? 'Enviando...' : 'Enviar mis datos ✓'}
          </button>
        </form>
      </div>
    </div>
  );
}
