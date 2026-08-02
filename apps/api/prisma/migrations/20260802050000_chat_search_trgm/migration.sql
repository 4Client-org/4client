-- Full-history search across Chats WPP (message text, customer name, phone).
-- Without an index this is a full sequential scan of ticket_messages on every
-- search - genuinely too slow to grow with, not a "maybe someday" concern.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Postgres's own unaccent() is marked STABLE, not IMMUTABLE, so it can't be
-- used directly inside an index expression ("functions in index expression
-- must be marked IMMUTABLE"). This is the standard, documented Postgres
-- workaround: wrap it in a trivial SQL function we explicitly promise is
-- IMMUTABLE. Same function is used both in the index definition below AND in
-- every query against it - the expressions must match exactly for the planner
-- to actually use the index.
--
-- Named parameter + fully schema-qualified public.unaccent(...) call,
-- single-argument form - confirmed the hard way that a positional `$1` with
-- a bare (non-schema-qualified) `unaccent($1)` call fails with "function
-- unaccent(text) does not exist" at CREATE INDEX time on some Postgres
-- setups (reproduced on Railway's managed Postgres) even though the exact
-- same call resolves fine as a standalone top-level query - a function-
-- inlining/resolution quirk, not a real missing overload (`\df unaccent`
-- shows both the 1-arg and 2-arg forms present). This form is what actually
-- works everywhere it's been tried.
CREATE OR REPLACE FUNCTION immutable_unaccent(input text) RETURNS text AS $$
  SELECT public.unaccent(input);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- gin_trgm_ops supports LIKE/ILIKE pattern matching via the index (not just
-- the %similarity% operator) - exactly what a "buscar palabra dentro del
-- mensaje" search needs. WHERE text IS NOT NULL keeps the index from wasting
-- space on the many media-only messages that have no text at all.
CREATE INDEX IF NOT EXISTS ticket_messages_text_trgm_idx
  ON "ticket_messages" USING gin (immutable_unaccent(lower(text)) gin_trgm_ops)
  WHERE text IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_customer_name_trgm_idx
  ON "tickets" USING gin (immutable_unaccent(lower(customer_name)) gin_trgm_ops)
  WHERE customer_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_phone_trgm_idx
  ON "tickets" USING gin (phone gin_trgm_ops);
