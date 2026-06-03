-- AlterTable: add marketplace listing fields to InventoryEntry
ALTER TABLE "InventoryEntry" ADD COLUMN "forSale"        BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "InventoryEntry" ADD COLUMN "quantityListed" DOUBLE PRECISION;
ALTER TABLE "InventoryEntry" ADD COLUMN "askingPrice"    INTEGER;
ALTER TABLE "InventoryEntry" ADD COLUMN "priceNote"      TEXT;

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable: Trade
CREATE TABLE "Trade" (
    "id"                TEXT        NOT NULL,
    "inventoryEntryId"  TEXT        NOT NULL,
    "listingSnapshot"   JSONB       NOT NULL,
    "buyerGuildId"      TEXT        NOT NULL,
    "buyerId"           TEXT        NOT NULL,
    "buyerUsername"     TEXT        NOT NULL,
    "quantityRequested" DOUBLE PRECISION NOT NULL,
    "note"              TEXT,
    "status"            "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_inventoryEntryId_fkey"
    FOREIGN KEY ("inventoryEntryId") REFERENCES "InventoryEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "InventoryEntry_forSale_memberActive_itemType_externalItemId_idx"
    ON "InventoryEntry"("forSale", "memberActive", "itemType", "externalItemId");

CREATE INDEX "Trade_inventoryEntryId_status_idx"
    ON "Trade"("inventoryEntryId", "status");

CREATE INDEX "Trade_buyerId_idx"
    ON "Trade"("buyerId");
