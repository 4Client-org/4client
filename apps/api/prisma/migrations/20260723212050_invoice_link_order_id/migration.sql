-- AlterTable
ALTER TABLE "invoice_links" ADD COLUMN "order_id" UUID;

-- CreateIndex
CREATE INDEX "invoice_links_order_id_idx" ON "invoice_links"("order_id");
