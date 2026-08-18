-- AlterTable: add registrationMessageId so the bot can edit the live sign-up embed
ALTER TABLE "Tournament" ADD COLUMN "registrationMessageId" TEXT;
