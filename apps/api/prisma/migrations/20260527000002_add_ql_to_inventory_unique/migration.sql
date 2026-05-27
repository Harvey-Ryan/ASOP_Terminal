-- Drop the location-only unique index. Uniqueness is now enforced at the
-- application layer: same (guildId, userId, itemType, externalItemId, location,
-- qualityLevel) updates an existing row; a different qualityLevel creates a new row.
DROP INDEX IF EXISTS "InventoryEntry_guildId_userId_itemType_externalItemId_location_key";

-- Composite index to make the new upsert findFirst lookup fast.
CREATE INDEX "InventoryEntry_upsert_lookup_idx"
ON "InventoryEntry"("guildId", "userId", "itemType", "externalItemId", "location", "qualityLevel");
