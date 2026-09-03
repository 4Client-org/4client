-- NOTA: Prisma generó también un "DROP INDEX tickets_phone_trgm_idx" acá -
-- se quitó a propósito. Ese índice GIN trigram se creó vía SQL crudo y
-- Prisma no lo puede declarar como @@index real en schema.prisma, así que
-- cada migración nueva lo vuelve a proponer para borrar - nunca aplicar ese
-- DROP, se rompe la búsqueda de chats.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "wpp_redirect_message" TEXT;
