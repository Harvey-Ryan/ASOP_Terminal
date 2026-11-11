-- v1.11.2 clean-up: the old scunpacked copy in public is no longer read or synced
-- (game data lives in the sc-data worker's scdata schema). On Railway,
-- `prisma db push --accept-data-loss` drops these on start; this file records it.
DROP TABLE IF EXISTS "ScBlueprintMaterial", "ScBlueprintModifier", "ScBlueprintRewardPool", "ScBlueprintTier",
  "ScBlueprint", "ScMissionRewardPool", "ScMission", "ScSyncLog", "ScManufacturer", "ScStarmapEntry",
  "ScTradeLocation", "ScTag", "ScCommodity", "ScResourceLocation", "ScResource", "ScLabel", "ScShipItem" CASCADE;
