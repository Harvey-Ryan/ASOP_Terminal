-- v1.19.0: after-action notes and attendee comments. On Railway, `prisma db push` adds these on start.
ALTER TABLE "Event" ADD COLUMN "aarOutcome" TEXT;
ALTER TABLE "Event" ADD COLUMN "aarNotes" TEXT;
ALTER TABLE "Event" ADD COLUMN "aarById" TEXT;
ALTER TABLE "Event" ADD COLUMN "aarByName" TEXT;
ALTER TABLE "Event" ADD COLUMN "aarAt" TIMESTAMP(3);
CREATE TABLE "EventComment" (
  "id" SERIAL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventComment_eventId_userId_key" ON "EventComment"("eventId", "userId");
