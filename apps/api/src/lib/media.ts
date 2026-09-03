import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// SIEMPRE disco local, nunca R2 - a diferencia de files.ts's invoice PDFs
// (que sí van a R2 si está configurado). Decisión explícita del negocio: R2
// es solo para las facturas de pedido que genera 4Client, no para imágenes/
// audios/videos/documentos que pasan por el chat de WhatsApp. Mismo modelo
// de "el token opaco es el único gate" que formLink.ts usa para form links -
// una foto de chat solo la busca staff que ya tiene este token exacto (vino
// de una fila de TicketMessage que puede ver), no hay nada más que chequear
// más allá de "existe este token" una vez pasado el propio auth de la ruta.
const UPLOADS_MEDIA_DIR = path.join(process.cwd(), 'uploads', 'media');
const MEDIA_TOKEN_BYTES = 20;

// The token itself carries its own extension (e.g. "<40 hex chars>.jpg") so the
// real Content-Type can be recovered on GET without a separate DB column - the
// hex portion is what's actually unguessable, the extension is just routing info.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Voice notes/audio - WhatsApp's own recorder sends audio/ogg;codecs=opus
  // (normalizeMime below strips the ";codecs=..." part before this lookup).
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

// Meta reports some audio mime types with a codec parameter appended
// (e.g. "audio/ogg; codecs=opus") - strip it before any MIME_EXT lookup, or
// every voice note would silently fall through to the generic .bin extension.
export function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isSupportedImageMime(mimeType: string): boolean {
  return mimeType in MIME_EXT;
}

const AUDIO_MIMES = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp']);
const DOCUMENT_MIMES = new Set(['application/pdf']);

export function isSupportedAudioMime(mimeType: string): boolean { return AUDIO_MIMES.has(normalizeMime(mimeType)); }
export function isSupportedVideoMime(mimeType: string): boolean { return VIDEO_MIMES.has(normalizeMime(mimeType)); }
export function isSupportedDocumentMime(mimeType: string): boolean { return DOCUMENT_MIMES.has(normalizeMime(mimeType)); }

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

// Lighter-weight signature check for the non-image types - a real byte-signature
// check where the format has one reliable enough to be worth it (PDF, MP4-family,
// OGG), otherwise falls back to trusting the declared/normalized mime type. This
// is a deliberately weaker bar than images: images can come from ANY staff
// browser upload (the open case detectImageMime defends), while audio/video/
// document here always arrive either from Meta's own webhook (Meta already
// transcoded/validated it before ever handing it to us) or from a staff upload
// gated to a fixed allow-list of mime types in the first place - not an open
// "any file, any name" upload surface.
export function detectMediaMime(buffer: Buffer, declaredMime: string): string | null {
  const declared = normalizeMime(declaredMime);
  if (declared === 'application/pdf') {
    return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF' ? declared : null;
  }
  if (declared === 'video/mp4' || declared === 'audio/mp4') {
    // ISO-BMFF box layout: 4-byte size, then "ftyp" at offset 4.
    return buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp' ? declared : null;
  }
  if (declared === 'audio/ogg') {
    return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS' ? declared : null;
  }
  // audio/mpeg (mp3) and audio/amr and video/3gpp don't have a signature check
  // here - trust the declared mime as long as it's already on the allow-list
  // (isSupportedAudioMime/VideoMime/DocumentMime, checked by the caller before
  // this ever runs).
  if (AUDIO_MIMES.has(declared) || VIDEO_MIMES.has(declared) || DOCUMENT_MIMES.has(declared)) return declared;
  return null;
}

export async function storeMedia(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = MIME_EXT[normalizeMime(mimeType)] ?? 'bin';
  const token = `${crypto.randomBytes(MEDIA_TOKEN_BYTES).toString('hex')}.${ext}`;
  if (!fs.existsSync(UPLOADS_MEDIA_DIR)) fs.mkdirSync(UPLOADS_MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_MEDIA_DIR, token), buffer);
  return token;
}

export async function loadMedia(token: string): Promise<Buffer> {
  return fs.promises.readFile(path.join(UPLOADS_MEDIA_DIR, token));
}

export function mimeTypeForToken(token: string): string {
  const ext = path.extname(token).slice(1).toLowerCase();
  return Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
}

// Only a bare "<hex>.<ext>" shape is ever valid - guards both the storage key
// (no path traversal) and the GET route (no arbitrary lookups).
export function isValidMediaToken(token: string): boolean {
  return /^[0-9a-f]{40}\.(jpg|png|webp|ogg|mp3|m4a|amr|mp4|3gp|pdf|bin)$/.test(token);
}
