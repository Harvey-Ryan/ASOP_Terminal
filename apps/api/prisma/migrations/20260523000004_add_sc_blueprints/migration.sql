-- ScBlueprint
CREATE TABLE "ScBlueprint" (
    "uuid"                TEXT NOT NULL,
    "key"                 TEXT NOT NULL,
    "kind"                TEXT NOT NULL,
    "outputUuid"          TEXT NOT NULL,
    "outputName"          TEXT NOT NULL,
    "outputClass"         TEXT NOT NULL,
    "outputType"          TEXT NOT NULL,
    "outputSubtype"       TEXT,
    "outputGrade"         TEXT,
    "categoryUuid"        TEXT,
    "dismantleTimeSecs"   INTEGER,
    "dismantleEfficiency" DOUBLE PRECISION,
    "syncedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScBlueprint_pkey" PRIMARY KEY ("uuid")
);
CREATE UNIQUE INDEX "ScBlueprint_key_key"        ON "ScBlueprint"("key");
CREATE INDEX "ScBlueprint_outputName_idx"        ON "ScBlueprint"("outputName");
CREATE INDEX "ScBlueprint_outputType_idx"        ON "ScBlueprint"("outputType");

-- ScBlueprintTier
CREATE TABLE "ScBlueprintTier" (
    "id"            TEXT NOT NULL,
    "blueprintUuid" TEXT NOT NULL,
    "tierIndex"     INTEGER NOT NULL,
    "craftTimeSecs" INTEGER NOT NULL,
    CONSTRAINT "ScBlueprintTier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScBlueprintTier_blueprintUuid_fkey"
        FOREIGN KEY ("blueprintUuid") REFERENCES "ScBlueprint"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScBlueprintTier_blueprintUuid_tierIndex_key" ON "ScBlueprintTier"("blueprintUuid", "tierIndex");
CREATE INDEX "ScBlueprintTier_blueprintUuid_idx" ON "ScBlueprintTier"("blueprintUuid");

-- ScBlueprintMaterial
CREATE TABLE "ScBlueprintMaterial" (
    "id"          TEXT NOT NULL,
    "tierId"      TEXT NOT NULL,
    "kind"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "itemUuid"    TEXT,
    "quantityScu" DOUBLE PRECISION,
    "quantity"    INTEGER,
    "minQuality"  INTEGER,
    "groupKey"    TEXT,
    CONSTRAINT "ScBlueprintMaterial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScBlueprintMaterial_tierId_fkey"
        FOREIGN KEY ("tierId") REFERENCES "ScBlueprintTier"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScBlueprintMaterial_tierId_idx" ON "ScBlueprintMaterial"("tierId");
CREATE INDEX "ScBlueprintMaterial_name_idx"   ON "ScBlueprintMaterial"("name");

-- ScBlueprintModifier
CREATE TABLE "ScBlueprintModifier" (
    "id"            TEXT NOT NULL,
    "tierId"        TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "unitFormat"    TEXT,
    "qualityMin"    INTEGER NOT NULL,
    "qualityMax"    INTEGER NOT NULL,
    "modifierAtMin" DOUBLE PRECISION NOT NULL,
    "modifierAtMax" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "ScBlueprintModifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScBlueprintModifier_tierId_fkey"
        FOREIGN KEY ("tierId") REFERENCES "ScBlueprintTier"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScBlueprintModifier_tierId_idx" ON "ScBlueprintModifier"("tierId");

-- ScBlueprintRewardPool
CREATE TABLE "ScBlueprintRewardPool" (
    "id"            TEXT NOT NULL,
    "blueprintUuid" TEXT NOT NULL,
    "poolUuid"      TEXT NOT NULL,
    "poolKey"       TEXT NOT NULL,
    CONSTRAINT "ScBlueprintRewardPool_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScBlueprintRewardPool_blueprintUuid_fkey"
        FOREIGN KEY ("blueprintUuid") REFERENCES "ScBlueprint"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScBlueprintRewardPool_blueprintUuid_idx" ON "ScBlueprintRewardPool"("blueprintUuid");
CREATE INDEX "ScBlueprintRewardPool_poolUuid_idx"      ON "ScBlueprintRewardPool"("poolUuid");

-- ScSyncLog
CREATE TABLE "ScSyncLog" (
    "id"                TEXT NOT NULL,
    "trigger"           TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'RUNNING',
    "blueprintsAdded"   INTEGER NOT NULL DEFAULT 0,
    "blueprintsUpdated" INTEGER NOT NULL DEFAULT 0,
    "error"             TEXT,
    "startedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"       TIMESTAMP(3),
    CONSTRAINT "ScSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScSyncLog_status_idx"    ON "ScSyncLog"("status");
CREATE INDEX "ScSyncLog_startedAt_idx" ON "ScSyncLog"("startedAt");
