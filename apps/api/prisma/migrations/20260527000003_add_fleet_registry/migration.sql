-- Add fleetEnabled toggle to GuildSettings
ALTER TABLE "GuildSettings" ADD COLUMN "fleetEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Create FleetEntry table
CREATE TABLE "FleetEntry" (
  "id"           TEXT          NOT NULL,
  "guildId"      TEXT          NOT NULL,
  "userId"       TEXT          NOT NULL,
  "username"     TEXT          NOT NULL,
  "shipSlug"     TEXT          NOT NULL,
  "shipName"     TEXT          NOT NULL,
  "manufacturer" TEXT          NOT NULL,
  "quantity"     INTEGER       NOT NULL DEFAULT 1,
  "notes"        TEXT,
  "memberActive" BOOLEAN       NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "FleetEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetEntry_guildId_userId_shipSlug_key"
  ON "FleetEntry"("guildId", "userId", "shipSlug");

CREATE INDEX "FleetEntry_guildId_shipSlug_idx"
  ON "FleetEntry"("guildId", "shipSlug");

CREATE INDEX "FleetEntry_guildId_userId_idx"
  ON "FleetEntry"("guildId", "userId");

CREATE INDEX "FleetEntry_guildId_memberActive_idx"
  ON "FleetEntry"("guildId", "memberActive");
