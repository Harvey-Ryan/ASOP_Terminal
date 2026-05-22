ALTER TABLE "Event" ADD COLUMN "livePosted" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: events whose start time has already passed don't need the announcement
UPDATE "Event" SET "livePosted" = true WHERE "startTime" <= NOW() OR status IN ('ENDED', 'COMPLETED');
