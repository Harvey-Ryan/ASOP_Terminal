-- Add allianceId to Event
ALTER TABLE "Event" ADD COLUMN "allianceId" TEXT;

-- CreateIndex
CREATE INDEX "Event_allianceId_idx" ON "Event"("allianceId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_allianceId_fkey"
  FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable EventAllianceGuild
CREATE TABLE "EventAllianceGuild" (
    "id"              TEXT NOT NULL,
    "eventId"         TEXT NOT NULL,
    "discordGuildId"  TEXT NOT NULL,
    "threadId"        TEXT,
    "rosterMessageId" TEXT,
    "discordEventId"  TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAllianceGuild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex unique
CREATE UNIQUE INDEX "EventAllianceGuild_eventId_discordGuildId_key"
  ON "EventAllianceGuild"("eventId", "discordGuildId");

-- CreateIndex
CREATE INDEX "EventAllianceGuild_eventId_idx" ON "EventAllianceGuild"("eventId");

-- AddForeignKey
ALTER TABLE "EventAllianceGuild" ADD CONSTRAINT "EventAllianceGuild_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
