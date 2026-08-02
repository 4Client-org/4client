-- Corrects the previous migration's backfill (20260802000000_ticket_last_activity),
-- which seeded last_activity_at from last_message_at (inbound-only) - so any
-- ticket where staff had already replied BEFORE that migration ran kept
-- showing sorted by its last INBOUND message in the Chats WPP panel, not the
-- real last activity. This recomputes it from the true message history
-- (both directions) instead. Idempotent/safe to re-run - only ever moves a
-- ticket's last_activity_at forward (GREATEST), never backwards.
UPDATE "tickets" t
SET "last_activity_at" = GREATEST(
  COALESCE(t."last_activity_at", '1970-01-01'::timestamptz),
  COALESCE((SELECT MAX(m."created_at") FROM "ticket_messages" m WHERE m."ticket_id" = t."id"), '1970-01-01'::timestamptz)
)
WHERE EXISTS (
  SELECT 1 FROM "ticket_messages" m
  WHERE m."ticket_id" = t."id" AND m."created_at" > COALESCE(t."last_activity_at", '1970-01-01'::timestamptz)
);
