-- AlterTable: what the board's ordering actually uses now - set once, on the
-- FIRST inbound message of a calendar day, never touched again until tomorrow
-- (webhook.ts's isFirstMessageToday). Fixes a real bug: last_message_at (the
-- previous ordering field) keeps moving forward on every later message the
-- same day, so an active customer's ticket kept sinking down the board even
-- though they were the first to arrive that day.
ALTER TABLE "tickets" ADD COLUMN     "first_message_today_at" TIMESTAMPTZ;

-- Backfill for tickets that already have messages today (Bogota local day,
-- UTC-5 fixed offset, no DST - same boundary math webhook.ts already uses) -
-- without this, every ticket active today would show as NULL (sorts first)
-- until its next message tomorrow reset the field, which would visibly
-- reshuffle today's board the moment this deploys instead of just fixing it.
UPDATE "tickets" t
SET "first_message_today_at" = sub.first_in
FROM (
  SELECT ticket_id, MIN(created_at) AS first_in
  FROM "ticket_messages"
  WHERE direction = 'in'
    AND created_at >= (date_trunc('day', now() - interval '5 hours') + interval '5 hours')
  GROUP BY ticket_id
) sub
WHERE t.id = sub.ticket_id AND t."first_message_today_at" IS NULL;
