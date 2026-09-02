-- NOTA: Prisma generó también un "DROP INDEX tickets_phone_trgm_idx" acá -
-- se quitó a propósito. Ese índice GIN trigram se creó vía SQL crudo
-- (20260802000000_ticket_last_activity/20260802050000_chat_search_trgm) y
-- Prisma no lo puede declarar como @@index real en schema.prisma, así que
-- CADA migración nueva lo vuelve a proponer para borrar - nunca aplicar ese
-- DROP, se rompe la búsqueda de chats. Ver memoria de sesión / CLAUDE.md.

-- AlterTable
ALTER TABLE "platform_charges" ADD COLUMN     "amounts" JSONB,
ALTER COLUMN "types" DROP DEFAULT;
