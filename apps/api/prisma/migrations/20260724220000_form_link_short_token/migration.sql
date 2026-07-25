-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "form_link_sent_by" UUID,
ADD COLUMN     "form_link_token" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_form_link_token_key" ON "tickets"("form_link_token");
