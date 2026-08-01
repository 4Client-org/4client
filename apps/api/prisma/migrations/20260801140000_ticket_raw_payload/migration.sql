-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "raw_payload" JSONB;

-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN "raw_payload" JSONB;
