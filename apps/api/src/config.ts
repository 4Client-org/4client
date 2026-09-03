import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL:              z.string().min(1),
  JWT_SECRET:                z.string().min(32),
  JWT_REFRESH_SECRET:        z.string().min(32),
  NODE_ENV:                  z.enum(['development', 'production', 'test']).default('development'),
  // Railway sets this per-environment (e.g. "production", "dev") - unlike NODE_ENV,
  // which is "production" on EVERY Railway environment (it controls build/runtime
  // optimizations, not which environment this is) and so can't tell a real prod
  // deploy apart from a dev/staging one on the same platform. Checks that must only
  // be strict on the ACTUAL live environment (e.g. "is a Meta webhook secret
  // mandatory") need this, not NODE_ENV - see webhook.ts and dev.ts's /seed route.
  RAILWAY_ENVIRONMENT_NAME:  z.string().optional(),
  PORT:                      z.coerce.number().default(3000),
  FRONTEND_URL:              z.string().default('http://localhost:5173'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID:      z.string().optional(),
  META_ACCESS_TOKEN:         z.string().optional(),
  META_APP_SECRET:           z.string().optional(),
  WPP_TOKEN_ENC_KEY:         z.string().regex(/^[0-9a-f]{64}$/, 'debe ser 64 hex chars (32 bytes)').optional(),
  R2_ACCOUNT_ID:             z.string().optional(),
  R2_ACCESS_KEY_ID:          z.string().optional(),
  R2_SECRET_ACCESS_KEY:      z.string().optional(),
  R2_BUCKET_NAME:            z.string().optional(),
  R2_PUBLIC_URL:             z.string().optional(),
  SENTRY_DSN:                z.string().optional(),
  // Sin default a propósito (antes 'admin123'/'josejose' - literales en este
  // mismo archivo, público). Quedan OPCIONALES acá (no se exigen al arrancar
  // el servidor entero - romperías un dev local o CI que nunca las necesitó)
  // pero routes/dev.ts's POST /dev/seed las exige explícitamente y rechaza la
  // request si faltan, en vez de caer a un valor conocido de antemano por
  // cualquiera con acceso al repo - mismo criterio que ya usa scripts/seed.ts
  // de forma independiente.
  SEED_ADMIN_PASS:           z.string().min(8).optional(),
  SEED_DEV_PASS:             z.string().min(8).optional(),
  RESEND_API_KEY:            z.string().optional(),
  // Explicit opt-in, not derived from RAILWAY_ENVIRONMENT_NAME - this scopes the
  // login verification-code step to dev only for now (per the original ask),
  // toggled directly in Railway's env vars for that one environment rather than
  // inferred from an environment NAME string that could be renamed/duplicated.
  REQUIRE_2FA:               z.coerce.boolean().default(false),
  // "Tomar lista" (routes/inbox.ts's /parse-messages): free-tier AI providers
  // chained as fallback (services/ai/index.ts tries them in order, skipping any
  // whose key isn't set) - a deliberate prototype-phase choice, not a claim that
  // any one of these is production-grade on its own. All optional so the feature
  // is a no-op (throws a clear error, doesn't crash the server) with none set.
  GEMINI_API_KEY:            z.string().optional(),
  GROQ_API_KEY:              z.string().optional(),
  CEREBRAS_API_KEY:          z.string().optional(),
  OPENROUTER_API_KEY:        z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

// SECURITY: without this key, lib/crypto.ts's encryptSecret() silently becomes
// a no-op (returns the plaintext unchanged) - every organization's WhatsApp
// access token would get written to `organizations.wpp_meta_token` in clear
// text instead of AES-256-GCM ciphertext, with no error or warning anywhere.
// Same RAILWAY_ENVIRONMENT_NAME-gated fail-closed pattern already used for
// META_APP_SECRET (webhook.ts) - a dev/staging deploy with no key configured
// yet is expected and shouldn't crash-loop, but the real production
// environment must never silently downgrade to storing these in plaintext.
if (!config.WPP_TOKEN_ENC_KEY && config.RAILWAY_ENVIRONMENT_NAME === 'production') {
  console.error('❌ WPP_TOKEN_ENC_KEY es obligatorio en producción - sin él, los tokens de WhatsApp de cada organización se guardarían sin cifrar. Configúralo antes de desplegar (64 hex chars = 32 bytes).');
  process.exit(1);
}
