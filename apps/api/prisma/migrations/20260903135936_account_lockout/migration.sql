-- NOTA: Prisma generó también un "DROP INDEX tickets_phone_trgm_idx" acá -
-- se quitó a propósito (índice GIN trigram creado por SQL crudo, Prisma
-- siempre lo vuelve a proponer para borrar - nunca aplicar ese DROP).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ;
