-- AlterTable: separate "last real activity in either direction" from
-- last_message_at (which stays inbound-only, driving the board's fixed
-- arrival order - see schema.prisma's comment on both fields).
ALTER TABLE "tickets" ADD COLUMN     "last_activity_at" TIMESTAMPTZ;

-- Backfill: best available baseline for existing rows.
UPDATE "tickets" SET "last_activity_at" = "last_message_at";

-- Maintained by trigger, not application code - there are 14+ separate
-- TicketMessage insert sites across webhook.ts/inbox.ts/public.ts (both
-- directions), and a trigger can never be forgotten at the next one the way a
-- manual bump call could be. Uses created_at (server insertion time, always
-- monotonic - see TicketMessage.created_at's own comment on why this codebase
-- never orders by sent_at), guarded with GREATEST so a delayed/out-of-order
-- insert can't ever move this backwards.
CREATE OR REPLACE FUNCTION bump_ticket_last_activity() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "tickets"
  SET "last_activity_at" = GREATEST(COALESCE("last_activity_at", NEW."created_at"), NEW."created_at")
  WHERE "id" = NEW."ticket_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_ticket_last_activity ON "ticket_messages";
CREATE TRIGGER trg_bump_ticket_last_activity
AFTER INSERT ON "ticket_messages"
FOR EACH ROW EXECUTE FUNCTION bump_ticket_last_activity();
