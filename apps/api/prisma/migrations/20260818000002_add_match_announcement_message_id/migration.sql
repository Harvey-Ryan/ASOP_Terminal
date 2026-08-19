-- Add announcementMessageId to TournamentMatch so the bot can edit the
-- match-card embed when a match time is scheduled.
ALTER TABLE "TournamentMatch" ADD COLUMN "announcementMessageId" TEXT;
