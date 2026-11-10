-- Inventory entries point at the game's own item/commodity UUID (scdata),
-- not only at a UEX id. Existing rows are linked at API start-up
-- (INVENTORY_LINK_SQL in packages/shared/src/catalog.ts).
ALTER TABLE "InventoryEntry" ADD COLUMN "itemUuid" TEXT;
ALTER TABLE "InventoryEntry" ALTER COLUMN "externalItemId" DROP NOT NULL;
CREATE INDEX "InventoryEntry_guildId_itemType_itemUuid_idx" ON "InventoryEntry"("guildId", "itemType", "itemUuid");
CREATE INDEX "InventoryEntry_forSale_memberActive_itemType_itemUuid_idx" ON "InventoryEntry"("forSale", "memberActive", "itemType", "itemUuid");
