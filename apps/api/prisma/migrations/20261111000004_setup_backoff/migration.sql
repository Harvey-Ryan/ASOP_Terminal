-- v1.11.1: back-off for Discord setup retries; remembered slash-command registration
ALTER TABLE "Event" ADD COLUMN "setupAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Event" ADD COLUMN "nextSetupAt" TIMESTAMP(3);
ALTER TABLE "EventGuildShare" ADD COLUMN "setupAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventGuildShare" ADD COLUMN "nextSetupAt" TIMESTAMP(3);
ALTER TABLE "BotConfig" ADD COLUMN "commandRegistration" TEXT;
