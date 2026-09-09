import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { api } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

// A 7-day refresh cookie means a browser tab left open and untouched would otherwise stay
// authenticated indefinitely (each API call silently refreshes it) - fine for "remember me
// across days", not fine for "I stepped away from an unlocked computer for an hour". This
// tracks actual user interaction, independent of any background API/refresh activity, and
// force-logs-out after IDLE_LIMIT_MS of no mouse/keyboard/touch/scroll at all.
export function useIdleLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function logout() {
      api.post('/auth/logout', {}).catch(() => {});
      disconnectSocket();
      clearAuth();
      // Same cache-clear as MainPage's own handleLogout (security-audit
      // finding) - this IS the shared-computer scenario the comment above
      // describes, so leaving cached data behind here would defeat the point.
      qc.clear();
    }
    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_LIMIT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [clearAuth, qc]);
}
