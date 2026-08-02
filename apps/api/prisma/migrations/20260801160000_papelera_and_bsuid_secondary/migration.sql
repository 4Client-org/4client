-- AlterTable: staff "papelera" trash now records who/why/where-to-restore
ALTER TABLE "orders" ADD COLUMN     "papelera_by" UUID,
ADD COLUMN     "papelera_reason" VARCHAR(500),
ADD COLUMN     "status_before_papelera" VARCHAR(20);

-- AlterTable: secondary identifier - lets a later BSUID-only message from a
-- customer already known by real phone number resolve to the same ticket
-- instead of fragmenting into a duplicate (see Ticket.bsuid's own comment).
ALTER TABLE "tickets" ADD COLUMN     "bsuid" VARCHAR(150);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_bsuid_key" ON "tickets"("bsuid");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_papelera_by_fkey" FOREIGN KEY ("papelera_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
