ALTER TABLE "GuildSettings"
  ADD COLUMN "eventBotEnabled"           BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN "dkpEnabled"                BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN "lootEnabled"               BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN "exchangeEnabled"           BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN "dkpDefaultAuctionDuration" INTEGER  NOT NULL DEFAULT 24,
  ADD COLUMN "dkpMinBid"                 INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN "lootDefaultMethod"         TEXT     NOT NULL DEFAULT 'RANDOM_ROLL';
