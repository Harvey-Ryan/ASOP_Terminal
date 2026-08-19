-- Add h2hChannelId to GuildSettings for dedicated H2H result announcement channel
ALTER TABLE "GuildSettings" ADD COLUMN "h2hChannelId" TEXT;
