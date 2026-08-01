import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { resolveApiBase } from '../lib/apiBase';

const API = resolveApiBase();

// Shared by every non-image chat media component (ChatAudio/ChatVideo/
// ChatDocument) - same fetch-as-blob pattern ChatImage.tsx uses on its own
// (extracted here instead of duplicating it three more times): a chat media
// file is served through our own staff-authenticated route (inbox.ts's GET
// /media/:token), never a public URL, so a plain <audio src>/<video src> can't
// carry the bearer header - this fetches the bytes itself and hands back a
// short-lived local object URL instead.
export function useChatMediaBlob(token: string): { src: string | null; failed: boolean } {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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

  return { src, failed };
}
