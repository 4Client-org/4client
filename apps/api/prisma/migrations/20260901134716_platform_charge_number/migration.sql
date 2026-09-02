-- AlterTable
-- SERIAL crea la secuencia, la deja como default, y rellena las filas
-- existentes en orden automáticamente - 0 filas en producción y en dev al
-- momento de este cambio (recién se generó una factura de prueba local para
-- validar el diseño), así que no hay datos reales que reordenar.
ALTER TABLE "platform_charges" ADD COLUMN "number" SERIAL;

-- CreateIndex
CREATE UNIQUE INDEX "platform_charges_number_key" ON "platform_charges"("number");
