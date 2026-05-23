-- CreateTable
CREATE TABLE "LootDraftQueue" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LootDraftQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LootDraftQueue_sessionId_userId_itemId_key" ON "LootDraftQueue"("sessionId", "userId", "itemId");

-- CreateIndex
CREATE INDEX "LootDraftQueue_sessionId_userId_idx" ON "LootDraftQueue"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "LootDraftQueue_itemId_idx" ON "LootDraftQueue"("itemId");

-- AddForeignKey
ALTER TABLE "LootDraftQueue" ADD CONSTRAINT "LootDraftQueue_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "LootSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootDraftQueue" ADD CONSTRAINT "LootDraftQueue_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "LootItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
