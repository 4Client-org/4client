import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { encryptSecret } from './lib/crypto.js';

const prisma = new PrismaClient();

// One-time migration: encryptSecret()/decryptSecret() (lib/crypto.ts) already
// handle both encrypted ("enc:v1:...") and legacy plain-text values
// transparently, so nothing broke when WPP_TOKEN_ENC_KEY was first introduced -
// but any wpp_meta_token written BEFORE that (or through seed-wpp.ts/
// update-org-wpp.ts before they were fixed to call encryptSecret) stays
// plain-text in the database forever unless something re-saves it. This
// re-saves every org's token that isn't already encrypted, once.
async function main() {
  if (!config.WPP_TOKEN_ENC_KEY) {
    throw new Error('WPP_TOKEN_ENC_KEY no está seteada - sin eso, esto no puede cifrar nada (encryptSecret sería un no-op).');
  }

  const orgs = await prisma.organization.findMany({
    where: { wpp_meta_token: { not: null } },
    select: { id: true, name: true, wpp_meta_token: true },
  });

  let migrated = 0;
  for (const org of orgs) {
    if (org.wpp_meta_token!.startsWith('enc:v1:')) {
      console.log(`- ${org.name}: ya estaba cifrado, sin cambios`);
      continue;
    }
    await prisma.organization.update({
      where: { id: org.id },
      data: { wpp_meta_token: encryptSecret(org.wpp_meta_token!) },
    });
    migrated++;
    console.log(`✅ ${org.name}: token re-cifrado`);
  }

  console.log(`\nListo - ${migrated} de ${orgs.length} organización(es) re-cifradas.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
