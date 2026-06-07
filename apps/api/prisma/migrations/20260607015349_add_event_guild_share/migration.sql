-- CreateEnum
CREATE TYPE "ShareSource" AS ENUM ('ALLIANCE', 'DIRECT');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "AllianceMember" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Auction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "allianceTag" TEXT;

-- AlterTable
ALTER TABLE "ScBlueprint" ALTER COLUMN "syncedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EventGuildShare" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceType" "ShareSource" NOT NULL,
    "allianceId" TEXT,
    "status" "ShareStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "EventGuildShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventGuildShare_eventId_idx" ON "EventGuildShare"("eventId");

-- CreateIndex
CREATE INDEX "EventGuildShare_guildId_idx" ON "EventGuildShare"("guildId");

-- CreateIndex
CREATE INDEX "EventGuildShare_status_idx" ON "EventGuildShare"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EventGuildShare_eventId_guildId_key" ON "EventGuildShare"("eventId", "guildId");

-- CreateIndex
CREATE INDEX "LootAuction_guildId_status_idx" ON "LootAuction"("guildId", "status");

-- CreateIndex
CREATE INDEX "LootAuction_closesAt_status_idx" ON "LootAuction"("closesAt", "status");

-- AddForeignKey
ALTER TABLE "EventGuildShare" ADD CONSTRAINT "EventGuildShare_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuildShare" ADD CONSTRAINT "EventGuildShare_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "InventoryEntry_upsert_lookup_idx" RENAME TO "InventoryEntry_guildId_userId_itemType_externalItemId_locat_idx";
