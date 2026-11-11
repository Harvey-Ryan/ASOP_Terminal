-- v1.21.0: job board. On Railway, `prisma db push` creates these on start.
ALTER TABLE "GuildSettings" ADD COLUMN "jobsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "jobsChannelId" TEXT;
CREATE TABLE "Job" (
  "id" TEXT PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "posterId" TEXT NOT NULL,
  "posterName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT,
  "reward" TEXT,
  "location" TEXT,
  "whenText" TEXT,
  "slots" INTEGER NOT NULL DEFAULT 1,
  "visibility" TEXT NOT NULL DEFAULT 'SERVER',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "messages" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Job_status_visibility_idx" ON "Job"("status", "visibility");
CREATE INDEX "Job_guildId_status_idx" ON "Job"("guildId", "status");
CREATE INDEX "Job_posterId_idx" ON "Job"("posterId");
CREATE TABLE "JobCrew" (
  "id" SERIAL PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "guildId" TEXT,
  "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobCrew_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobCrew_jobId_userId_key" ON "JobCrew"("jobId", "userId");
CREATE INDEX "JobCrew_userId_idx" ON "JobCrew"("userId");
