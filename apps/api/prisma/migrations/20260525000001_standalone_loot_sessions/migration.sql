-- Make eventId nullable (standalone sessions have no event)
ALTER TABLE "LootSession" ALTER COLUMN "eventId" DROP NOT NULL;

-- Add name for standalone session labels
ALTER TABLE "LootSession" ADD COLUMN "name" TEXT;

-- Add participants pool for standalone sessions
ALTER TABLE "LootSession" ADD COLUMN "participants" TEXT NOT NULL DEFAULT '[]';

-- Add composite index for listing sessions by guild + status
CREATE INDEX "LootSession_status_guildId_idx" ON "LootSession"("status", "guildId");
