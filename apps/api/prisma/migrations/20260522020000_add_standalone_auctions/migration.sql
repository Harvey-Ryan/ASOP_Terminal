CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startedById" TEXT NOT NULL,
    "durationSecs" INTEGER NOT NULL DEFAULT 120,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "winnerId" TEXT,
    "winnerUsername" TEXT,
    "winningBid" INTEGER,
    "discordMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Auction_guildId_status_idx" ON "Auction"("guildId", "status");
CREATE INDEX "Auction_closesAt_status_idx" ON "Auction"("closesAt", "status");

CREATE TABLE "AuctionBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuctionBid_auctionId_userId_key" ON "AuctionBid"("auctionId", "userId");
CREATE INDEX "AuctionBid_auctionId_idx" ON "AuctionBid"("auctionId");

ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_auctionId_fkey"
    FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
