-- AlterTable: add optional recurEndsAt to Event
-- Recurring events currently run forever; this field allows organisers to set
-- a hard stop date. Null = no end date (existing behaviour unchanged).
ALTER TABLE "Event" ADD COLUMN "recurEndsAt" TIMESTAMP(3);
