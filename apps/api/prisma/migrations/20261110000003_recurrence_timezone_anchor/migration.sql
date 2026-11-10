-- Recurring events: keep the series in the organiser's time zone and anchored
-- to its first occurrence (see packages/shared/src/recurrence.ts).
ALTER TABLE "Event" ADD COLUMN "recurTimezone" TEXT;
ALTER TABLE "Event" ADD COLUMN "recurAnchor" TIMESTAMP(3);
