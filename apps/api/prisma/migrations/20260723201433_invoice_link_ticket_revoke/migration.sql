-- AlterTable
ALTER TABLE "invoice_links" ADD COLUMN "ticket_id" UUID;
ALTER TABLE "invoice_links" ADD COLUMN "revoked_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "invoice_links_ticket_id_idx" ON "invoice_links"("ticket_id");
