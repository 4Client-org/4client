-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: for existing rows, created_at defaulting to "now" at migration time
-- would put every historical message at the same instant, breaking their
-- relative order entirely. Copy sent_at into created_at for pre-existing rows
-- instead - not perfectly accurate for any row that really was delayed, but a
-- vastly better starting point than collapsing all of history to one instant,
-- and new rows going forward get a genuine, accurate created_at.
UPDATE "ticket_messages" SET "created_at" = "sent_at";
