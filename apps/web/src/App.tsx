import { useState, useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { tryRestoreSession } from './lib/api';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import ClientFormPage from './pages/ClientFormPage';
import UpdateBanner from './components/ui/UpdateBanner';

export default function App() {
  const isForm = window.location.pathname === '/form';

  const token = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isForm) { setReady(true); return; }
    tryRestoreSession().finally(() => setReady(true));
  }, [isForm]);

  if (isForm) return <><ClientFormPage /><UpdateBanner /></>;
  if (!ready) return <UpdateBanner />;
  return <>{token ? <MainPage /> : <LoginPage />}<UpdateBanner /></>;
}
