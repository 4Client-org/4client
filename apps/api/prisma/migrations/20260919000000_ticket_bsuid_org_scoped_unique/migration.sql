-- Security-audit finding (deep-profile): Ticket.bsuid was a GLOBAL unique
-- constraint, not scoped per organization like Ticket.phone already is. A
-- WhatsApp BSUID identifies a real customer account, not something tied to
-- one business - the same customer messaging two different orgs on this
-- platform produced the same bsuid for both, so the second org's webhook
-- ingest hit this constraint and threw an unhandled P2002 (the existing P2002
-- recovery path re-resolves scoped to its OWN org_id, found nothing, and
-- re-threw), silently losing that org's ability to record the conversation.
-- Scoping the constraint to (org_id, bsuid) matches (org_id, phone) and closes
-- this cross-tenant availability defect. NULL bsuid values remain unaffected -
-- Postgres treats each NULL as distinct in a unique index, same as before.

DROP INDEX "tickets_bsuid_key";

CREATE UNIQUE INDEX "tickets_org_id_bsuid_key" ON "tickets"("org_id", "bsuid");
