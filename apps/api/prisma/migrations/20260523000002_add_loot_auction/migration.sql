-- CreateTable
CREATE TABLE "LootAuction" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "durationSecs" INTEGER NOT NULL DEFAULT 120,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "winnerId" TEXT,
    "winnerUsername" TEXT,
    "winningBid" INTEGER,
    "discordMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootAuction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootAuctionBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxBid" INTEGER NOT NULL DEFAULT 0,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LootAuctionBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LootAuction_itemId_key" ON "LootAuction"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "LootAuctionBid_auctionId_userId_key" ON "LootAuctionBid"("auctionId", "userId");

-- CreateIndex
CREATE INDEX "LootAuctionBid_auctionId_idx" ON "LootAuctionBid"("auctionId");

-- AddForeignKey
ALTER TABLE "LootAuction" ADD CONSTRAINT "LootAuction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LootItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LootAuctionBid" ADD CONSTRAINT "LootAuctionBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LootAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
