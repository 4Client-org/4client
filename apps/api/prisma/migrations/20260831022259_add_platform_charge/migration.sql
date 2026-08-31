-- NOTA: `prisma migrate dev` generó de nuevo el falso positivo ya documentado
-- en 20260830042938_add_product_in_stock/migration.sql - un DROP INDEX de
-- tickets_phone_trgm_idx (índice GIN trigram creado a mano en
-- 20260802000000_chat_search_trgm, que schema.prisma no puede declarar). Se
-- quita a propósito, no se toca ese índice.

-- CreateTable
CREATE TABLE "platform_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "period" VARCHAR(7),
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pendiente',
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "notes" TEXT,
    "report_url" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_charges_org_id_due_date_idx" ON "platform_charges"("org_id", "due_date");

-- AddForeignKey
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
