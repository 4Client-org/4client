-- NOTA: prisma migrate diff propuso también un "DROP INDEX tickets_phone_trgm_idx"
-- acá - se quitó a propósito (índice GIN trigram creado por SQL crudo, Prisma
-- siempre lo vuelve a proponer para borrar - nunca aplicar ese DROP).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" VARCHAR(30);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
