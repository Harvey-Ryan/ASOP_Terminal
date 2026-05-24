-- Add detailsJson to ScSyncLog
ALTER TABLE "ScSyncLog" ADD COLUMN "detailsJson" TEXT;

-- ScManufacturer
CREATE TABLE "ScManufacturer" (
  "uuid"        TEXT NOT NULL,
  "code"        TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "syncedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScManufacturer_pkey" PRIMARY KEY ("uuid")
);
CREATE INDEX "ScManufacturer_name_idx" ON "ScManufacturer"("name");

-- ScStarmapEntry
CREATE TABLE "ScStarmapEntry" (
  "uuid"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "parentUuid"    TEXT,
  "navIcon"       TEXT,
  "type"          TEXT NOT NULL,
  "isScannable"   BOOLEAN NOT NULL DEFAULT false,
  "hideInStarmap" BOOLEAN NOT NULL DEFAULT false,
  "size"          DOUBLE PRECISION,
  "amenitiesJson" TEXT,
  "syncedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScStarmapEntry_pkey" PRIMARY KEY ("uuid")
);
CREATE INDEX "ScStarmapEntry_name_idx"       ON "ScStarmapEntry"("name");
CREATE INDEX "ScStarmapEntry_type_idx"       ON "ScStarmapEntry"("type");
CREATE INDEX "ScStarmapEntry_parentUuid_idx" ON "ScStarmapEntry"("parentUuid");

-- ScTradeLocation
CREATE TABLE "ScTradeLocation" (
  "uuid"             TEXT NOT NULL,
  "className"        TEXT NOT NULL,
  "displayName"      TEXT,
  "disabled"         BOOLEAN NOT NULL DEFAULT false,
  "producesTagsJson" TEXT,
  "consumesTagsJson" TEXT,
  "syncedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScTradeLocation_pkey"          PRIMARY KEY ("uuid"),
  CONSTRAINT "ScTradeLocation_className_key" UNIQUE ("className")
);
CREATE INDEX "ScTradeLocation_displayName_idx" ON "ScTradeLocation"("displayName");

-- ScTag
CREATE TABLE "ScTag" (
  "uuid" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "ScTag_pkey" PRIMARY KEY ("uuid")
);
CREATE INDEX "ScTag_name_idx" ON "ScTag"("name");

-- ScCommodity
CREATE TABLE "ScCommodity" (
  "uuid"               TEXT NOT NULL,
  "key"                TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "description"        TEXT,
  "refinedVersionUuid" TEXT,
  "refinedVersionName" TEXT,
  "tier"               TEXT,
  "densityGPerCc"      DOUBLE PRECISION,
  "instability"        DOUBLE PRECISION,
  "resistance"         DOUBLE PRECISION,
  "syncedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScCommodity_pkey"     PRIMARY KEY ("uuid"),
  CONSTRAINT "ScCommodity_key_key"  UNIQUE ("key")
);
CREATE INDEX "ScCommodity_name_idx" ON "ScCommodity"("name");
CREATE INDEX "ScCommodity_tier_idx" ON "ScCommodity"("tier");

-- ScResourceLocation
CREATE TABLE "ScResourceLocation" (
  "uuid"          TEXT NOT NULL,
  "providerName"  TEXT NOT NULL,
  "presetFile"    TEXT NOT NULL,
  "locationsJson" TEXT NOT NULL,
  "areasJson"     TEXT,
  "groupsJson"    TEXT,
  "syncedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScResourceLocation_pkey"           PRIMARY KEY ("uuid"),
  CONSTRAINT "ScResourceLocation_presetFile_key" UNIQUE ("presetFile")
);

-- ScResource
CREATE TABLE "ScResource" (
  "uuid"            TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "harvestableUuid" TEXT,
  "harvestableKey"  TEXT,
  "tier"            TEXT,
  "syncedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScResource_pkey"    PRIMARY KEY ("uuid"),
  CONSTRAINT "ScResource_key_key" UNIQUE ("key")
);
CREATE INDEX "ScResource_name_idx" ON "ScResource"("name");
CREATE INDEX "ScResource_kind_idx" ON "ScResource"("kind");

-- ScLabel
CREATE TABLE "ScLabel" (
  "key"      TEXT NOT NULL,
  "value"    TEXT NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScLabel_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "ScLabel_value_idx" ON "ScLabel"("value");

-- ScShipItem
CREATE TABLE "ScShipItem" (
  "uuid"             TEXT NOT NULL,
  "className"        TEXT NOT NULL,
  "itemName"         TEXT NOT NULL,
  "type"             TEXT NOT NULL,
  "subType"          TEXT,
  "size"             INTEGER,
  "grade"            INTEGER,
  "name"             TEXT,
  "classification"   TEXT,
  "tags"             TEXT,
  "manufacturerCode" TEXT,
  "manufacturerName" TEXT,
  "manufacturerUuid" TEXT,
  "description"      TEXT,
  "mass"             DOUBLE PRECISION,
  "inventoryScu"     DOUBLE PRECISION,
  "stdItemJson"      TEXT NOT NULL,
  "syncedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScShipItem_pkey"          PRIMARY KEY ("uuid"),
  CONSTRAINT "ScShipItem_className_key" UNIQUE ("className")
);
CREATE INDEX "ScShipItem_name_idx"             ON "ScShipItem"("name");
CREATE INDEX "ScShipItem_type_idx"             ON "ScShipItem"("type");
CREATE INDEX "ScShipItem_classification_idx"   ON "ScShipItem"("classification");
CREATE INDEX "ScShipItem_manufacturerCode_idx" ON "ScShipItem"("manufacturerCode");
