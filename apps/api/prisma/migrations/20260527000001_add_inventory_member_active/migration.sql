-- Track whether the Discord member is still in the guild.
-- False = member left (entries hidden from search/whohas but preserved).
-- Reset to true when the member rejoins via GuildMemberAdd bot event.
ALTER TABLE "InventoryEntry" ADD COLUMN "memberActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "InventoryEntry_guildId_memberActive_idx" ON "InventoryEntry"("guildId", "memberActive");
