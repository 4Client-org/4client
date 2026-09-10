import crypto from 'crypto';
import { config } from '../config.js';

const PREFIX_V1 = 'enc:v1:'; // legacy: single master key, no per-org derivation
const PREFIX_V2 = 'enc:v2:'; // current: per-org derived key
const ALGO = 'aes-256-gcm';

// Printed once at most, not per-call - encryptSecret() runs on every WhatsApp
// config save, and this module has no fastify logger to hook into (it's a pure
// lib, imported before the server even starts in some scripts). Visibility-only
// fix (security-audit finding): without WPP_TOKEN_ENC_KEY, encryptSecret()
// silently writes plaintext with no signal anywhere that it's happening -
// config.ts already fails the server outright in real production, so this only
// ever fires in dev/staging, where it's expected but still worth a heads-up.
let warnedPlaintextFallback = false;
function getMasterKey(): Buffer | null {
  if (!config.WPP_TOKEN_ENC_KEY) {
    if (!warnedPlaintextFallback && config.NODE_ENV !== 'test') {
      warnedPlaintextFallback = true;
      console.warn('⚠️  WPP_TOKEN_ENC_KEY no configurado - los tokens de WhatsApp se están guardando SIN cifrar en esta base de datos.');
    }
    return null;
  }
  return Buffer.from(config.WPP_TOKEN_ENC_KEY, 'hex');
}

// Derives a per-organization subkey from the single master key (HMAC-SHA256,
// which conveniently outputs exactly 32 bytes - the right size for
// aes-256-gcm already, no truncation/expansion needed). A single shared master
// key encrypting every org's WhatsApp token directly meant one key leak
// decrypted every organization's secrets at once - security-audit finding.
// Deriving per org means a leaked DERIVED key (which never leaves this
// function) only ever exposed that one org's ciphertext anyway, so this is
// pure defense-in-depth against the key material itself being mishandled
// downstream, not a response to any known leak path.
function deriveOrgKey(masterKey: Buffer, orgId: string): Buffer {
  return crypto.createHmac('sha256', masterKey).update(orgId).digest();
}

// Encrypts WhatsApp credentials at rest, scoped to one organization. No-op
// (returns plaintext) when WPP_TOKEN_ENC_KEY isn't set, so dev environments
// work without extra setup.
export function encryptSecret(plain: string, orgId: string): string {
  const masterKey = getMasterKey();
  if (!masterKey) return plain;

  const key = deriveOrgKey(masterKey, orgId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return PREFIX_V2 + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// Transparently reads v2 (per-org derived key, current), v1 (legacy - shared
// master key directly, pre-dates per-org derivation), and legacy plaintext
// (written before WPP_TOKEN_ENC_KEY was ever configured) - no migration of
// existing rows needed, every format a row could already be in still decrypts
// correctly; only NEW writes (encryptSecret above) ever produce v2. `orgId` is
// required for v2 but simply unused for v1/plaintext, so passing the caller's
// current org id is always correct regardless of which format an old row is in.
export function decryptSecret(stored: string | null | undefined, orgId: string): string | null {
  if (!stored) return stored ?? null;
  if (!stored.startsWith(PREFIX_V1) && !stored.startsWith(PREFIX_V2)) return stored; // legacy plaintext

  const masterKey = getMasterKey();
  if (!masterKey) return stored; // can't decrypt without the key - caller will fail auth, which is safe

  const isV2 = stored.startsWith(PREFIX_V2);
  const key = isV2 ? deriveOrgKey(masterKey, orgId) : masterKey;
  const prefixLen = (isV2 ? PREFIX_V2 : PREFIX_V1).length;

  try {
    const raw = Buffer.from(stored.slice(prefixLen), 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
