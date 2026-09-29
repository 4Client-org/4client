-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "privacy_policy_version" VARCHAR(20);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "privacy_policy_version" VARCHAR(20);
