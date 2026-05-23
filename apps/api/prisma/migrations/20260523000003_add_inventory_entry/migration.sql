-- CreateTable
CREATE TABLE "InventoryEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "externalItemId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "qualityLevel" INTEGER,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntry_guildId_userId_itemType_externalItemId_key" ON "InventoryEntry"("guildId", "userId", "itemType", "externalItemId");

-- CreateIndex
CREATE INDEX "InventoryEntry_guildId_itemType_externalItemId_idx" ON "InventoryEntry"("guildId", "itemType", "externalItemId");

-- CreateIndex
CREATE INDEX "InventoryEntry_guildId_userId_idx" ON "InventoryEntry"("guildId", "userId");
