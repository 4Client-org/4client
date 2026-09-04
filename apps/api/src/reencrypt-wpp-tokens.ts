import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { encryptSecret } from './lib/crypto.js';

const prisma = new PrismaClient();

// One-time migration: encryptSecret()/decryptSecret() (lib/crypto.ts) already
// handle both encrypted ("enc:v1:...") and legacy plain-text values
// transparently, so nothing broke when WPP_TOKEN_ENC_KEY was first introduced -
// but any wpp_meta_token/wpp_meta_app_secret written BEFORE that (or through
// seed-wpp.ts/update-org-wpp.ts before they were fixed to call encryptSecret)
// stays plain-text in the database forever unless something re-saves it. This
// re-saves every org's value in both columns that isn't already encrypted, once.
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
    if (org.wpp_meta_token && !org.wpp_meta_token.startsWith('enc:v1:')) {
      data.wpp_meta_token = encryptSecret(org.wpp_meta_token);
    }
    if (org.wpp_meta_app_secret && !org.wpp_meta_app_secret.startsWith('enc:v1:')) {
      data.wpp_meta_app_secret = encryptSecret(org.wpp_meta_app_secret);
    }
    if (Object.keys(data).length === 0) {
      console.log(`- ${org.name}: ya estaba cifrado, sin cambios`);
      continue;
    }
    await prisma.organization.update({ where: { id: org.id }, data });
    migrated++;
    console.log(`✅ ${org.name}: ${Object.keys(data).join(' + ')} re-cifrado(s)`);
  }

  console.log(`\nListo - ${migrated} de ${orgs.length} organización(es) re-cifradas.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
