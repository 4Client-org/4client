-- NOTA: prisma migrate diff propuso también un "DROP INDEX tickets_phone_trgm_idx"
-- acá - se quitó a propósito (índice GIN trigram creado por SQL crudo, Prisma
-- siempre lo vuelve a proponer para borrar - nunca aplicar ese DROP).

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "consent_given_at" TIMESTAMPTZ;
