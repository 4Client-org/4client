import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import PasswordInput from '../components/ui/PasswordInput';
import { isDevEnvironment } from '../lib/apiBase';

export default function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Only set when the backend has REQUIRE_2FA on (currently dev-only, see
  // config.ts) and /auth/login answered with `pending2fa` instead of a real
  // session - a second screen (code) replaces the credentials form while this
  // is set. Going back to null re-shows credentials, which is also how you
  // "resend" a code (logging in again mints a fresh one).
  const [pending2fa, setPending2fa] = useState<{ userId: string } | null>(null);
  const [code, setCode] = useState('');

  function applySession(apiUser: any, accessToken: string) {
    setAuth(
      { accessToken },
      { ...apiUser, userId: apiUser.id, orgId: apiUser.org_id, orgName: apiUser.org_name, orgSlug: apiUser.org_slug },
    );
  }

  async function handleLogin() {
    if (!email || !password) { setError('Ingresa usuario y contraseña'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ data: any }>('/auth/login', { email, password });
      if (res.data.pending2fa) {
        setPending2fa({ userId: res.data.userId });
        return;
      }
      applySession(res.data.user, res.data.accessToken);
    } catch (e: any) {
      // Always the same message no matter what actually failed (wrong password, unknown
      // email, validation error, network failure...) - a message that varies by failure
      // reason is exactly the kind of signal that lets an attacker enumerate valid emails
      // or probe the backend. Real reason still goes to the console for our own debugging.
      console.error('[login] failed', e);
      setError('Usuario o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!pending2fa || code.trim().length !== 6) { setError('Ingresa el código de 6 dígitos'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ data: any }>('/auth/login/verify-code', { userId: pending2fa.userId, code: code.trim() });
      applySession(res.data.user, res.data.accessToken);
    } catch (e: any) {
      // Unlike the credentials step above, a specific message here is safe - the
      // user already proved they know the password, this is just brute-force/
      // expiry feedback on a one-time code, not identity-enumeration risk.
      console.error('[login] verify code failed', e);
      setError(e.message ?? 'Código inválido');
      if (e.code === 'CODE_EXPIRED' || e.code === 'CODE_LOCKED') {
        setPending2fa(null);
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lbg">
      <div className="lbg-overlay" />
      <div className="lcard">
        {isDevEnvironment() && (
          <div style={{
            background: '#DC2626', color: '#fff', fontWeight: 900, fontSize: 20,
            padding: '8px 0', borderRadius: 10, letterSpacing: '2px',
            textAlign: 'center', marginBottom: 14,
          }}>
            DEV
          </div>
        )}
        <div className="llogo">
          <img src="/logo.png" alt="4Client" style={{ height: 120, objectFit: 'contain' }} />
        </div>
        <p className="lsub">Sistema de Gestión Operativa</p>
        {!pending2fa ? (
          <>
            <div className="fg">
              <label className="fl">Correo</label>
              <input className="fi" type="email" placeholder="correo@empresa.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            </div>
            <div className="fg">
              <label className="fl">Contraseña</label>
              <PasswordInput className="fi" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            </div>
            <button className="bpri" onClick={handleLogin} disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar al sistema'}
            </button>
          </>
        ) : (
          <>
            <div className="fg">
              <label className="fl">Código de verificación</label>
              <p style={{ fontSize: 13, color: 'var(--gt)', marginTop: -4, marginBottom: 8 }}>
                Te enviamos un código de 6 dígitos por correo. Vence en 5 minutos.
              </p>
              <input className="fi" type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                style={{ letterSpacing: '6px', fontSize: 20, textAlign: 'center' }}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()} />
            </div>
            <button className="bpri" onClick={handleVerifyCode} disabled={loading}>
              {loading ? 'Verificando...' : 'Verificar código'}
            </button>
            <button
              onClick={() => { setPending2fa(null); setCode(''); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--gt)', fontSize: 13, marginTop: 10, cursor: 'pointer', width: '100%' }}>
              Volver a iniciar sesión
            </button>
          </>
        )}
        <div className="login-err">{error}</div>
        <div className="lfooter">4client.shop</div>
      </div>
    </div>
  );
}
