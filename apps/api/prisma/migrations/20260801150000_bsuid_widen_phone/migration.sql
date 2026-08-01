-- AlterTable: widen phone columns to fit a WhatsApp Business-Scoped User ID
-- (BSUID, up to 131 chars: "CC." + up to 128 alphanumeric chars), not just a
-- real phone number.
ALTER TABLE "tickets" ALTER COLUMN "phone" TYPE VARCHAR(150);
ALTER TABLE "orders" ALTER COLUMN "customer_phone" TYPE VARCHAR(150);
