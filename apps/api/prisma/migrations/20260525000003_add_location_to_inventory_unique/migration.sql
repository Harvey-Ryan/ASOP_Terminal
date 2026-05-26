-- Drop old unique index that excluded location
DROP INDEX IF EXISTS "InventoryEntry_guildId_userId_itemType_externalItemId_key";

-- Add new unique index that includes location.
-- NULLs are treated as distinct in PostgreSQL unique indexes by default,
-- so application code uses findFirst to match null-location entries correctly.
CREATE UNIQUE INDEX "InventoryEntry_guildId_userId_itemType_externalItemId_location_key"
ON "InventoryEntry"("guildId", "userId", "itemType", "externalItemId", "location");
