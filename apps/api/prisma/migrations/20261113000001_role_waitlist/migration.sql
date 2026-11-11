-- v1.14.0: waitlists for full roles. On Railway, `prisma db push` creates this on start.
CREATE TABLE "EventWaitlist" (
  "id" SERIAL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventWaitlist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventWaitlist_eventId_userId_key" ON "EventWaitlist"("eventId", "userId");
CREATE INDEX "EventWaitlist_eventId_role_idx" ON "EventWaitlist"("eventId", "role");
