-- CreateTable: UexCategory
CREATE TABLE "UexCategory" (
    "id"           INTEGER      NOT NULL,
    "type"         TEXT         NOT NULL,
    "section"      TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "dateModified" TEXT         NOT NULL,
    "syncedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UexCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UexCategory_type_idx"    ON "UexCategory"("type");
CREATE INDEX "UexCategory_section_idx" ON "UexCategory"("section");

-- CreateTable: UexItem
CREATE TABLE "UexItem" (
    "id"            INTEGER      NOT NULL,
    "name"          TEXT         NOT NULL,
    "slug"          TEXT         NOT NULL,
    "uuid"          TEXT,
    "section"       TEXT,
    "categoryId"    INTEGER      NOT NULL,
    "categoryName"  TEXT         NOT NULL,
    "size"          TEXT,
    "isCommodity"   BOOLEAN      NOT NULL DEFAULT false,
    "isHarvestable" BOOLEAN      NOT NULL DEFAULT false,
    "gameVersion"   TEXT,
    "attributes"    TEXT         NOT NULL DEFAULT '[]',
    "dateModified"  TEXT         NOT NULL,
    "isActive"      BOOLEAN      NOT NULL DEFAULT true,
    "syncedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UexItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UexItem_categoryId_idx" ON "UexItem"("categoryId");
CREATE INDEX "UexItem_name_idx"       ON "UexItem"("name");
CREATE INDEX "UexItem_isActive_idx"   ON "UexItem"("isActive");

-- AddForeignKey
ALTER TABLE "UexItem" ADD CONSTRAINT "UexItem_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "UexCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: UexCommodity
CREATE TABLE "UexCommodity" (
    "id"            INTEGER      NOT NULL,
    "name"          TEXT         NOT NULL,
    "code"          TEXT         NOT NULL,
    "slug"          TEXT         NOT NULL,
    "weightScu"     DOUBLE PRECISION,
    "priceAvgBuy"   DOUBLE PRECISION,
    "priceAvgSell"  DOUBLE PRECISION,
    "isMineral"     BOOLEAN      NOT NULL DEFAULT false,
    "isRaw"         BOOLEAN      NOT NULL DEFAULT false,
    "isRefined"     BOOLEAN      NOT NULL DEFAULT false,
    "isHarvestable" BOOLEAN      NOT NULL DEFAULT false,
    "isFuel"        BOOLEAN      NOT NULL DEFAULT false,
    "isIllegal"     BOOLEAN      NOT NULL DEFAULT false,
    "dateModified"  TEXT         NOT NULL,
    "isActive"      BOOLEAN      NOT NULL DEFAULT true,
    "syncedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UexCommodity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UexCommodity_name_idx"     ON "UexCommodity"("name");
CREATE INDEX "UexCommodity_isActive_idx" ON "UexCommodity"("isActive");
CREATE INDEX "UexCommodity_isIllegal_idx" ON "UexCommodity"("isIllegal");

-- CreateTable: UexSyncLog
CREATE TABLE "UexSyncLog" (
    "id"                 TEXT         NOT NULL,
    "trigger"            TEXT         NOT NULL,
    "triggeredById"      TEXT,
    "status"             TEXT         NOT NULL DEFAULT 'RUNNING',
    "categoriesAdded"    INTEGER      NOT NULL DEFAULT 0,
    "categoriesUpdated"  INTEGER      NOT NULL DEFAULT 0,
    "itemsAdded"         INTEGER      NOT NULL DEFAULT 0,
    "itemsUpdated"       INTEGER      NOT NULL DEFAULT 0,
    "commoditiesAdded"   INTEGER      NOT NULL DEFAULT 0,
    "commoditiesUpdated" INTEGER      NOT NULL DEFAULT 0,
    "error"              TEXT,
    "startedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"        TIMESTAMP(3),

    CONSTRAINT "UexSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UexSyncLog_status_idx"    ON "UexSyncLog"("status");
CREATE INDEX "UexSyncLog_startedAt_idx" ON "UexSyncLog"("startedAt");
