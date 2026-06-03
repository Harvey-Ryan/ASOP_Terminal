-- Add listedAt to InventoryEntry for soft listing expiry (14-day TTL).
-- Backfill existing for-sale rows with their updatedAt as a reasonable starting point.

ALTER TABLE "InventoryEntry" ADD COLUMN "listedAt" TIMESTAMP(3);

UPDATE "InventoryEntry"
SET    "listedAt" = "updatedAt"
WHERE  "forSale"  = true;
