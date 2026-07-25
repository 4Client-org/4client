import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { storage } from '../services/storage.js';

// Same R2-primary/local-fallback split as files.ts's invoice PDFs, and the same
// unbounded-token-as-the-only-gate model formLink.ts uses for form links - a chat
// photo is only ever looked up by staff who already have this exact token (came
// from a TicketMessage row they're allowed to see), so there's nothing extra to
// check beyond "does this token exist" once past the route's own staff-auth check.
const UPLOADS_MEDIA_DIR = path.join(process.cwd(), 'uploads', 'media');
const MEDIA_TOKEN_BYTES = 20;

// The token itself carries its own extension (e.g. "<40 hex chars>.jpg") so the
// real Content-Type can be recovered on GET without a separate DB column - the
// hex portion is what's actually unguessable, the extension is just routing info.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isSupportedImageMime(mimeType: string): boolean {
  return mimeType in MIME_EXT;
}

// Never trust a declared mime_type alone - it's just a string the sender's client
// (staff browser, or WhatsApp on the customer's phone) chose to send, not a fact
// about the bytes themselves. Checking the real file signature before storing or
// forwarding anything is what actually stops someone from uploading arbitrary
// content (an HTML/JS payload, a disguised executable) labeled as a photo - a
// mismatch here means either a corrupted upload or a deliberately spoofed one, and
// either way it shouldn't be stored/served as an image, let alone relayed to Meta.
const MAGIC_BYTES: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  { mime: 'image/jpeg', check: (buf) => buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF },
  {
    mime: 'image/png',
    check: (buf) => buf.length >= 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A,
  },
  {
    mime: 'image/webp',
    check: (buf) => buf.length >= 12
      && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
  },
];

// Returns the REAL mime type detected from the file's own bytes, or null if it
// doesn't match any supported image signature - regardless of what mime_type the
// upload claimed to be.
export function detectImageMime(buffer: Buffer): string | null {
  return MAGIC_BYTES.find(({ check }) => check(buffer))?.mime ?? null;
}

export async function storeMedia(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = MIME_EXT[mimeType] ?? 'bin';
  const token = `${crypto.randomBytes(MEDIA_TOKEN_BYTES).toString('hex')}.${ext}`;
  if (storage.isConfigured()) {
    await storage.upload(`media/${token}`, buffer, mimeType);
  } else {
    if (!fs.existsSync(UPLOADS_MEDIA_DIR)) fs.mkdirSync(UPLOADS_MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_MEDIA_DIR, token), buffer);
  }
  return token;
}

export async function loadMedia(token: string): Promise<Buffer> {
  if (storage.isConfigured()) return storage.download(`media/${token}`);
  return fs.promises.readFile(path.join(UPLOADS_MEDIA_DIR, token));
}

export function mimeTypeForToken(token: string): string {
  const ext = path.extname(token).slice(1).toLowerCase();
  return Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
}

// Only a bare "<hex>.<ext>" shape is ever valid - guards both the storage key
// (no path traversal) and the GET route (no arbitrary lookups).
export function isValidMediaToken(token: string): boolean {
  return /^[0-9a-f]{40}\.(jpg|png|webp|bin)$/.test(token);
}
