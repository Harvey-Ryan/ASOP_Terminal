-- Add activityEnabled toggle to GuildSettings
ALTER TABLE "GuildSettings" ADD COLUMN "activityEnabled" BOOLEAN NOT NULL DEFAULT true;
