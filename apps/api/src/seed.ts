import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
// No hardcoded fallback - a password baked into git history is a known password
// forever, for whichever account ends up created with it (this script's target org/
// emails match the real client, not a throwaway fixture). Failing loud here means
// the worst case of forgetting to set these is "the script refuses to run", not
// "creates or resets a real account to a string anyone with repo read access knows".
if (!process.env.SEED_ADMIN_PASS || !process.env.SEED_DEV_PASS) {
  console.error('❌ SEED_ADMIN_PASS y SEED_DEV_PASS son obligatorias (sin valor por defecto) - defínelas antes de correr el seed.');
  process.exit(1);
}
const SEED_ADMIN_PASS = process.env.SEED_ADMIN_PASS;
const SEED_DEV_PASS   = process.env.SEED_DEV_PASS;

const PRODUCTOS = [
  // Verduras
  { name: 'Ahuyama', category: 'Verduras' },
  { name: 'Ajo', category: 'Verduras' },
  { name: 'Apio', category: 'Verduras' },
  { name: 'Arracacha', category: 'Verduras' },
  { name: 'Arveja', category: 'Verduras' },
  { name: 'Brócoli', category: 'Verduras' },
  { name: 'Cebolla Blanca', category: 'Verduras' },
  { name: 'Cebolla Rama', category: 'Verduras' },
  { name: 'Cebolla Roja', category: 'Verduras' },
  { name: 'Cilantro', category: 'Verduras' },
  { name: 'Coliflor', category: 'Verduras' },
  { name: 'Espinaca', category: 'Verduras' },
  { name: 'Frijol Verde Vaina / Desgranado', category: 'Verduras' },
  { name: 'Guineo', category: 'Verduras' },
  { name: 'Habichuela', category: 'Verduras' },
  { name: 'Lechuga', category: 'Verduras' },
  { name: 'Mazorca Amarilla / Blanca', category: 'Verduras' },
  { name: 'Papa Criolla', category: 'Verduras' },
  { name: 'Papa Negra Capira / Nevada', category: 'Verduras' },
  { name: 'Pepino', category: 'Verduras' },
  { name: 'Pimentón Pintón / Maduro', category: 'Verduras' },
  { name: 'Plátano Maduro / Pintón', category: 'Verduras' },
  { name: 'Plátano Verde Artón', category: 'Verduras' },
  { name: 'Remolacha', category: 'Verduras' },
  { name: 'Repollo', category: 'Verduras' },
  { name: 'Tomate Aliño Pintón / Maduro', category: 'Verduras' },
  { name: 'Yuca', category: 'Verduras' },
  { name: 'Zanahoria', category: 'Verduras' },
  // Frutas
  { name: 'Aguacate', category: 'Frutas' },
  { name: 'Banano Pintón / Maduro', category: 'Frutas' },
  { name: 'Coco', category: 'Frutas' },
  { name: 'Fresas', category: 'Frutas' },
  { name: 'Guanábana', category: 'Frutas' },
  { name: 'Guayaba', category: 'Frutas' },
  { name: 'Granadilla', category: 'Frutas' },
  { name: 'Limón Mandarino / Tahiti', category: 'Frutas' },
  { name: 'Lulo', category: 'Frutas' },
  { name: 'Mandarina', category: 'Frutas' },
  { name: 'Mango Tommy', category: 'Frutas' },
  { name: 'Mango Criollo / Otro', category: 'Frutas' },
  { name: 'Manzanas Verdes / Maduras', category: 'Frutas' },
  { name: 'Maracuyá', category: 'Frutas' },
  { name: 'Mora Paquete x Libra', category: 'Frutas' },
  { name: 'Naranja', category: 'Frutas' },
  { name: 'Papaya', category: 'Frutas' },
  { name: 'Peras', category: 'Frutas' },
  { name: 'Piña', category: 'Frutas' },
  { name: 'Pulpas', category: 'Frutas' },
  { name: 'Tomate Árbol', category: 'Frutas' },
  { name: 'Kiwi', category: 'Frutas' },
  { name: 'Durazno', category: 'Frutas' },
  // Otros
  { name: 'Bandeja Granadilla', category: 'Otros' },
  { name: 'Bandeja Champiñon Grande', category: 'Otros' },
  { name: 'Bandeja Champiñon Pequeña', category: 'Otros' },
  { name: 'Bandeja Uva Isabella', category: 'Otros' },
  { name: 'Batata', category: 'Otros' },
  { name: 'Berenjena', category: 'Otros' },
  { name: 'Zuccini', category: 'Otros' },
  { name: 'Calabacín', category: 'Otros' },
  { name: 'Perejil', category: 'Otros' },
  { name: 'Cebolla Puerro', category: 'Otros' },
  { name: 'Coles', category: 'Otros' },
  { name: 'Cidra', category: 'Otros' },
];

async function main() {
  console.log('🌱 Iniciando seed...');

  // Organización
  const org = await prisma.organization.upsert({
    where: { slug: 'fruver-san-gabriel' },
    update: {},
    create: {
      name: 'Fruver San Gabriel',
      slug: 'fruver-san-gabriel',
      plan: 'starter',
      wpp_provider: 'meta_api',
      active: true,
    },
  });
  console.log(`✅ Org: ${org.name} (${org.id})`);

  // Usuario admin - `update: {}` on purpose: this script is meant to be safely
  // re-runnable to add/fix products (see the loop below) without silently resetting
  // a real, already-in-use account's password/role/active status back to whatever
  // this run's env vars happen to be. Only a genuinely NEW account gets these values;
  // an existing one is left exactly as staff has since changed it (e.g. via
  // POST /users/:id/reset-password, which is the actual supported way to reset one).
  const adminHash = await bcrypt.hash(SEED_ADMIN_PASS, 12);
  const admin = await prisma.user.upsert({
    where: { org_id_email: { org_id: org.id, email: 'admin@fruver.com' } },
    update: {},
    create: { org_id: org.id, email: 'admin@fruver.com', password_hash: adminHash, name: 'Juan Ignasio', role: 'admin' },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // Usuario dev (super-admin del sistema) - same "never touch an existing account"
  // reasoning as admin above.
  const devHash = await bcrypt.hash(SEED_DEV_PASS, 12);
  await prisma.user.upsert({
    where: { org_id_email: { org_id: org.id, email: 'dev@fruver.com' } },
    update: {},
    create: { org_id: org.id, email: 'dev@fruver.com', password_hash: devHash, name: 'Jose Alvarez', role: 'dev' },
  });
  console.log('✅ Dev: dev@fruver.com');

  // Productos
  let prodCount = 0;
  for (const [i, prod] of PRODUCTOS.entries()) {
    await prisma.product.upsert({
      where: { id: (await prisma.product.findFirst({ where: { org_id: org.id, name: prod.name } }))?.id ?? `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}` },
      update: {},
      create: { org_id: org.id, name: prod.name, category: prod.category, sort_order: i, active: true },
    }).catch(async () => {
      const exists = await prisma.product.findFirst({ where: { org_id: org.id, name: prod.name } });
      if (!exists) await prisma.product.create({ data: { org_id: org.id, name: prod.name, category: prod.category, sort_order: i } });
    });
    prodCount++;
  }
  console.log(`✅ ${prodCount} productos importados`);

  console.log('\n🎉 Seed completado!');
  console.log('─────────────────────────────────');
  console.log('Usuarios creados:');
  console.log('  admin@fruver.com  (admin)');
  console.log('  dev@fruver.com    (dev)');
  console.log('  → Contraseñas definidas por SEED_ADMIN_PASS / SEED_DEV_PASS');
  console.log('─────────────────────────────────');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
