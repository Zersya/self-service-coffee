ALTER TABLE "beans" ADD COLUMN "stock" numeric;
ALTER TABLE "orders" ADD COLUMN "stock_deducted" boolean DEFAULT false NOT NULL;
UPDATE "orders" SET "stock_deducted" = true;
