ALTER TABLE "LootAssignment" ADD COLUMN "delivered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LootAssignment" ADD COLUMN "deliveredAt" TIMESTAMP(3);
