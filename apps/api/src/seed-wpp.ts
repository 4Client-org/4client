import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { encryptSecret } from './lib/crypto.js';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error('No org found - run seed first');

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      wpp_meta_phone_id:   config.META_PHONE_NUMBER_ID ?? '',
      // Same encryptSecret() the config.ts route already uses - this script
      // used to write the token in plain text, same bug as update-org-wpp.ts.
      wpp_meta_token:      encryptSecret(config.META_ACCESS_TOKEN ?? ''),
      wpp_meta_app_secret: config.META_APP_SECRET ?? '',
      wpp_phone:           '+15556590674',
    },
  });

  console.log(`✅ Org "${org.name}" configurada con credenciales Meta WPP`);
  console.log(`   Phone ID: ${config.META_PHONE_NUMBER_ID}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
