import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { encryptSecret, decryptSecret } from './lib/crypto.js';

const prisma = new PrismaClient();

// One-time migration: encryptSecret()/decryptSecret() (lib/crypto.ts) already
// handle plain-text, legacy "enc:v1:..." (shared master key), and current
// "enc:v2:..." (per-org derived key) values transparently, so nothing breaks
// at runtime regardless of which format a row is already in. This re-saves
// every org's value that ISN'T already v2 (plaintext rows from before
// WPP_TOKEN_ENC_KEY existed, or v1 rows from before per-org key derivation
// was added) so the database converges on the current format over time.
async function main() {
  if (!config.WPP_TOKEN_ENC_KEY) {
    throw new Error('WPP_TOKEN_ENC_KEY no está seteada - sin eso, esto no puede cifrar nada (encryptSecret sería un no-op).');
  }

  const orgs = await prisma.organization.findMany({
    where: { OR: [{ wpp_meta_token: { not: null } }, { wpp_meta_app_secret: { not: null } }] },
    select: { id: true, name: true, wpp_meta_token: true, wpp_meta_app_secret: true },
  });

  let migrated = 0;
  for (const org of orgs) {
    const data: { wpp_meta_token?: string; wpp_meta_app_secret?: string } = {};
    if (org.wpp_meta_token && !org.wpp_meta_token.startsWith('enc:v2:')) {
      const plain = decryptSecret(org.wpp_meta_token, org.id);
      if (plain) data.wpp_meta_token = encryptSecret(plain, org.id);
    }
    if (org.wpp_meta_app_secret && !org.wpp_meta_app_secret.startsWith('enc:v2:')) {
      const plain = decryptSecret(org.wpp_meta_app_secret, org.id);
      if (plain) data.wpp_meta_app_secret = encryptSecret(plain, org.id);
    }
    if (Object.keys(data).length === 0) {
      console.log(`- ${org.name}: ya estaba en el formato actual, sin cambios`);
      continue;
    }
    await prisma.organization.update({ where: { id: org.id }, data });
    migrated++;
    console.log(`✅ ${org.name}: ${Object.keys(data).join(' + ')} re-cifrado(s)`);
  }

  console.log(`\nListo - ${migrated} de ${orgs.length} organización(es) re-cifradas.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
