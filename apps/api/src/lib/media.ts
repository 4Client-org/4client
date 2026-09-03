// Decisión explícita del negocio: NADA de imágenes/audios/videos/documentos
// del chat de WhatsApp se guarda de nuestro lado - ni en R2, ni en disco, ni
// como bytes en la BD. Se queda "como en WhatsApp normal": vive en los
// servidores de Meta, y acá solo se guarda el media_id que Meta ya nos da
// (misma idea que ya se hacía con wpp_message_id - una referencia, no el
// contenido). Cuando alguien necesita VER una foto/audio/video/documento,
// inbox.ts's GET /media/:id le pide una URL fresca a Meta (getMediaUrl) y
// descarga los bytes en el momento, sin guardar nada - Meta solo la retiene
// 30 días, pasado eso ya no hay forma de recuperarla, ni para nosotros ni
// para el negocio (decisión aceptada explícitamente, ver el commit).
//
// Antes de este cambio storeMedia()/loadMedia() guardaban una copia local -
// esas funciones ya no existen. Lo que queda acá es solo la validación de
// tipo/firma de archivo, que ahora se aplica en el momento de SERVIR el
// archivo (cada vez que se pide a Meta), no al ingresar el mensaje - incluso
// mejor defensa que antes (se revalida en cada vista, no solo una vez).
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
// (e.g. "audio/ogg; codecs=opus") - strip it before any mime-set lookup below,
// or every voice note would silently fail its allow-list check.
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

// Solo un filtro barato antes de tocar la BD/red - el gate real en
// inbox.ts's GET /media/:id es el lookup de TicketMessage scopeado a la
// organización del que pide, esto solo descarta basura obvia (Meta reporta
// media_id como una cadena numérica larga, pero se deja algo de margen por
// si Meta cambia el formato sin avisar).
export function isValidMetaMediaId(id: string): boolean {
  return /^[0-9]{5,40}$/.test(id);
}
