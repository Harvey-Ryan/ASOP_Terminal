ALTER TABLE "Auction" ADD COLUMN "eventId" TEXT;
CREATE INDEX "Auction_eventId_idx" ON "Auction"("eventId");
