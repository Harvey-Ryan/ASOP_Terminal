-- v1.13.0: admin panel and error monitoring. On Railway, `prisma db push` creates these on start.
CREATE TABLE "ErrorEvent" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "fingerprint" TEXT NOT NULL,
  "ref" TEXT,
  "guildId" TEXT,
  "userId" TEXT,
  "context" TEXT NOT NULL DEFAULT '{}',
  "release" TEXT NOT NULL DEFAULT '',
  "suppressed" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "ErrorEvent_createdAt_idx" ON "ErrorEvent"("createdAt");
CREATE INDEX "ErrorEvent_fingerprint_createdAt_idx" ON "ErrorEvent"("fingerprint", "createdAt");
CREATE INDEX "ErrorEvent_ref_idx" ON "ErrorEvent"("ref");
CREATE INDEX "ErrorEvent_guildId_createdAt_idx" ON "ErrorEvent"("guildId", "createdAt");
CREATE INDEX "ErrorEvent_source_level_createdAt_idx" ON "ErrorEvent"("source", "level", "createdAt");

CREATE TABLE "ErrorGroupState" (
  "fingerprint" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'open',
  "note" TEXT NOT NULL DEFAULT '',
  "resolvedAt" TIMESTAMP(3),
  "alertedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AdminLog" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "guildId" TEXT,
  "guildName" TEXT,
  "summary" TEXT NOT NULL,
  "details" TEXT NOT NULL DEFAULT '{}',
  "posted" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");
CREATE INDEX "AdminLog_guildId_createdAt_idx" ON "AdminLog"("guildId", "createdAt");
CREATE INDEX "AdminLog_kind_createdAt_idx" ON "AdminLog"("kind", "createdAt");

CREATE TABLE "AdminConfig" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "feedGuildId" TEXT,
  "feedChannelId" TEXT,
  "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
  "digestHour" INTEGER NOT NULL DEFAULT 8,
  "digestTimezone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "lastDigestDate" TEXT,
  "alertCursor" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ServiceHeartbeat" (
  "service" TEXT PRIMARY KEY,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "beatAt" TIMESTAMP(3) NOT NULL,
  "release" TEXT NOT NULL DEFAULT '',
  "details" TEXT NOT NULL DEFAULT '{}'
);
