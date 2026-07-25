-- CreateTable
CREATE TABLE "order_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_observations_order_id_idx" ON "order_observations"("order_id");

-- AddForeignKey
ALTER TABLE "order_observations" ADD CONSTRAINT "order_observations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_observations" ADD CONSTRAINT "order_observations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_observations" ADD CONSTRAINT "order_observations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migrate existing single-field notes into the new table before dropping the
-- column, so nothing written by staff so far is lost. Author is unknown for
-- these old entries (there was no per-note author before), so they're
-- attributed to whoever registered the order - the closest approximation of
-- "who was responsible for this order" available.
INSERT INTO "order_observations" ("id", "org_id", "order_id", "author_id", "text", "created_at", "updated_at")
SELECT gen_random_uuid(), "org_id", "id", "registered_by", "observacion", "updated_at", "updated_at"
FROM "orders"
WHERE "observacion" IS NOT NULL AND btrim("observacion") <> '';

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "observacion";
