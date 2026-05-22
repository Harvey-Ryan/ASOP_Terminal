ALTER TABLE "AuctionBid" ADD COLUMN "maxBid" INTEGER NOT NULL DEFAULT 0;
UPDATE "AuctionBid" SET "maxBid" = "amount" WHERE "maxBid" = 0;
