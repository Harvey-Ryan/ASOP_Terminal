-- Ally network (v1.9.0): one row per pair of orgs. Existing alliances and
-- direct ally links are copied in at API start-up (apps/api/src/lib/allies.ts).
CREATE TYPE "AllyStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'BLOCKED');

CREATE TABLE "GuildAlly" (
    "id" TEXT NOT NULL,
    "guildAId" TEXT NOT NULL,
    "guildBId" TEXT NOT NULL,
    "status" "AllyStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByGuildId" TEXT NOT NULL,
    "message" TEXT,
    "autoAcceptA" BOOLEAN NOT NULL DEFAULT false,
    "autoAcceptB" BOOLEAN NOT NULL DEFAULT false,
    "retryAfter" TIMESTAMP(3),
    "blockedByGuildId" TEXT,
    "requestedBy" TEXT,
    "respondedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "noticeChannelId" TEXT,
    "noticeMessageId" TEXT,
    CONSTRAINT "GuildAlly_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildAlly_guildAId_guildBId_key" ON "GuildAlly"("guildAId", "guildBId");
CREATE INDEX "GuildAlly_guildBId_idx" ON "GuildAlly"("guildBId");
CREATE INDEX "GuildAlly_status_idx" ON "GuildAlly"("status");
ALTER TABLE "GuildAlly" ADD CONSTRAINT "GuildAlly_guildAId_fkey" FOREIGN KEY ("guildAId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildAlly" ADD CONSTRAINT "GuildAlly_guildBId_fkey" FOREIGN KEY ("guildBId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuildSettings" ADD COLUMN "allyDirectoryListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "allyCode" TEXT;
CREATE UNIQUE INDEX "GuildSettings_allyCode_key" ON "GuildSettings"("allyCode");
