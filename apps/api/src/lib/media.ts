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
