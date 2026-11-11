-- v1.11.0: sharing events with allies
ALTER TABLE "EventGuildShare" ADD COLUMN "respondedBy" TEXT;
ALTER TABLE "EventGuildShare" ADD COLUMN "autoAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EventGuildShare" ADD COLUMN "noticeChannelId" TEXT;
ALTER TABLE "EventGuildShare" ADD COLUMN "noticeMessageId" TEXT;
