import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@4client/shared';
import { useAuthStore } from '../store/auth';
import { resolveApiBase } from './apiBase';
import { tryRefresh } from './api';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(_token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(resolveApiBase(), {
      // Read the token fresh from the store on every (re)connection attempt,
      // so a rotated access token doesn't leave the socket stuck with a stale one.
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken ?? '' }),
      transports: ['websocket'],
    });

    // Every backend deploy (or restart, crash, Railway maintenance) drops every
    // open socket. socket.io-client auto-reconnects on its own, but it reuses
    // whatever's in the auth callback above at that moment - if the access token
    // (15min expiry) had already gone stale by then, the reconnect's auth fails,
    // and unlike a normal HTTP call, nothing here was ever hitting a 401 to
    // trigger a refresh (a tab just sitting on an open order makes no API calls
    // on its own). Concretely: a client's form submission updates the order fine
    // (plain HTTP, no socket needed), but staff never saw it live update - the
    // socket was silently dead, sitting in a reconnect loop that could never
    // succeed until something else (a manual page reload) refreshed the token
    // first. Not narrowed to auth-looking messages specifically - the server's
    // actual rejection text ('No autorizado' / 'Token inválido') doesn't match
    // any reliable English pattern, and a refresh attempt on a genuine network
    // hiccup is harmless (it just fails too, and socket.io's own backoff keeps
    // retrying regardless).
    socket.on('connect_error', async () => {
      const refreshed = await tryRefresh();
      if (refreshed) socket?.connect();
    });

    // Extra safety net for the same failure mode - catches it the moment someone
    // switches back to an already-open tab, rather than waiting on socket.io's own
    // backoff timer (same trigger UpdateBanner.tsx already uses for its own
    // "check for a new deploy" poll).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && socket && !socket.connected) {
        socket.connect();
      }
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
