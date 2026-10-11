-- AlterTable (aditiva: columna nullable, el código anterior la ignora)
ALTER TABLE "orders" ADD COLUMN "credit_paid_at" TIMESTAMPTZ;

-- Relleno de los créditos ya saldados antes de esta columna: toma la fecha del
-- asiento "Crédito pagado." que PATCH /orders/:id/credito-pagado deja en el
-- historial (solo lee order_history; solo escribe la columna nueva).
UPDATE "orders" o
SET "credit_paid_at" = h.paid_at
FROM (
  SELECT "order_id", MAX("created_at") AS paid_at
  FROM "order_history"
  WHERE "action_type" = 'cobro' AND "notes" = 'Crédito pagado.'
  GROUP BY "order_id"
) h
WHERE o."id" = h."order_id"
  AND o."payment_method" = 'credito'
  AND o."paid" = true
  AND o."credit_paid_at" IS NULL;
