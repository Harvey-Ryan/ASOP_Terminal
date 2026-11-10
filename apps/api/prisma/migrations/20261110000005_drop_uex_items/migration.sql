-- Item data now comes from the game files (scdata). UEX is kept for commodity
-- prices only. Every inventory entry was linked to its game item (itemUuid)
-- before these were dropped; the UEX ids stay on those entries.
DROP TABLE IF EXISTS "UexItem";
DROP TABLE IF EXISTS "UexCategory";
