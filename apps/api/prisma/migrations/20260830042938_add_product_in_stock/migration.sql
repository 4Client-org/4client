-- AlterTable
ALTER TABLE "products" ADD COLUMN     "in_stock" BOOLEAN NOT NULL DEFAULT true;

-- NOTA: `prisma migrate dev` generó también un "DROP INDEX tickets_phone_trgm_idx"
-- acá - falso positivo de drift, no relacionado con este cambio. Ese índice se
-- creó a mano en 20260802050000_chat_search_trgm/migration.sql (un índice GIN
-- trigram que schema.prisma no puede declarar como @@index, así que Prisma no
-- lo "ve" y cada migrate dev futuro lo va a querer soltar de nuevo). Se quitó
-- esa línea a propósito - NUNCA aplicar un DROP INDEX de tickets_phone_trgm_idx
-- generado automáticamente por otra migración futura sin revisar primero.
