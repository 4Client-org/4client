import { MapPin } from 'lucide-react';

// Unlike every other media type, media_url here is already a plain, safe-to-link
// Google Maps URL (see webhook.ts's ingestLocationMessage) - just coordinates, not
// a file, so there's no auth-gated fetch/token to resolve, no blob URL needed.
export default function ChatLocation({ url, label }: { url: string; label?: string | null }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.05)',
        border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, padding: '8px 12px',
        maxWidth: 220, textDecoration: 'none', color: 'inherit',
      }}
    >
      <MapPin size={20} style={{ flexShrink: 0, color: '#DC2626' }} />
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label || 'Ver ubicación'}</span>
    </a>
  );
}
