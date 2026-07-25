import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface Props {
  // The public client-facing form is safe to reload the INSTANT a new version is
  // found - ClientFormPage.tsx already persists the in-progress order to
  // localStorage and restores it on mount, so there's nothing to lose. The staff
  // app has no such safety net for an open modal (address/items/prices mid-edit),
  // so it waits for a moment with no modal open instead of forcing it - see
  // `safeToReload` below.
  autoReloadImmediately?: boolean;
}

// registerType is 'prompt' (not 'autoUpdate') - vite-plugin-pwa never activates a
// newly-downloaded service worker on its own, it just sits there waiting
// (`needRefresh`) until something calls updateServiceWorker(true). This component
// is that "something" - a customer or a staff member stuck on stale code after a
// deploy (with no obvious reason to manually refresh) was the exact root cause
// behind a real "link inválido" incident: their browser kept running pre-fix JS
// indefinitely. Reloads automatically instead of showing a banner that requires a
// click nobody has a reason to make.
export default function UpdateBanner({ autoReloadImmediately = false }: Props) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Long-lived tabs (this app is meant to stay open a full shift) otherwise only
      // check for updates on load/navigation - poll periodically so a deploy is
      // discovered without requiring a manual refresh first.
      setInterval(() => registration.update(), 30 * 60 * 1000);
      // Also check right away whenever the tab regains focus - during an active work
      // session someone flips back to an already-open tab far more often than they
      // wait out a 30min timer, and that's the exact moment a just-shipped fix should
      // surface instead of silently sitting cached for up to half an hour more.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  const [waitingForSafeMoment, setWaitingForSafeMoment] = useState(false);
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (!needRefresh || reloadedRef.current) return;

    if (autoReloadImmediately) {
      reloadedRef.current = true;
      updateServiceWorker(true);
      return;
    }

    // Staff app: every open modal shares the same "moverlay" overlay class (see
    // TicketModal/NuevoPedidoModal/DetallePedidoModal/CierreCajaModal) - reload the
    // instant none is present, instead of interrupting whatever's mid-edit
    // (unsaved address/items/prices, with no draft-recovery for those). Checked on
    // an interval rather than once, since the exact moment to catch is "nothing
    // open right now", which can arrive well after this effect first runs.
    setWaitingForSafeMoment(true);
    const trySafeReload = () => {
      if (document.querySelector('.moverlay')) return;
      reloadedRef.current = true;
      updateServiceWorker(true);
    };
    trySafeReload();
    const iv = setInterval(trySafeReload, 3000);
    return () => clearInterval(iv);
  }, [needRefresh, autoReloadImmediately, updateServiceWorker]);

  // Only ever visible for the brief, uncommon window where a staff member happens
  // to have a modal open right when a new version is found - otherwise the reload
  // already happened before this would ever render anything.
  if (!waitingForSafeMoment || reloadedRef.current) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, background: '#0F4F30', color: '#fff',
        padding: '10px 16px', borderRadius: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,.3)',
        fontSize: 13, fontWeight: 700,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      Hay una nueva versión - se actualizará sola en cuanto cierres esta ventana
    </div>
  );
}
