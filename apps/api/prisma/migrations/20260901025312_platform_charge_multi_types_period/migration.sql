/*
  Warnings:

  - You are about to drop the column `due_date` on the `platform_charges` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `platform_charges` table. All the data in the column will be lost.
  - Made the column `period` on table `platform_charges` required. This step will fail if there are existing NULL values in that column.

*/
-- NOTA: `prisma migrate dev` generó de nuevo el falso positivo ya documentado
-- en 20260830042938_add_product_in_stock/migration.sql - un DROP INDEX de
-- tickets_phone_trgm_idx (índice GIN trigram creado a mano, que schema.prisma
-- no puede declarar). Se quita a propósito, no se toca ese índice.

-- DropIndex
DROP INDEX "platform_charges_org_id_due_date_idx";

-- AlterTable
-- 0 filas en platform_charges en dev y en producción al momento de esta
-- migración (tabla recién creada, nadie había registrado un cobro todavía) -
-- confirmado antes de escribir este DROP COLUMN, no hay datos que perder.
ALTER TABLE "platform_charges" DROP COLUMN "due_date",
DROP COLUMN "type",
ADD COLUMN     "types" TEXT[] NOT NULL DEFAULT '{}',
ALTER COLUMN "period" SET NOT NULL;

-- CreateIndex
CREATE INDEX "platform_charges_org_id_period_idx" ON "platform_charges"("org_id", "period");
