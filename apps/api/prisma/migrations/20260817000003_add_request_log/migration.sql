-- Add RequestLog table for admin traffic monitoring dashboard.
-- Write-only audit log; no FK relations (same pattern as ScSyncLog / UexSyncLog).
CREATE TABLE "RequestLog" (
  "id"         TEXT         NOT NULL,
  "method"     TEXT         NOT NULL,
  "path"       TEXT         NOT NULL,
  "module"     TEXT         NOT NULL,
  "guildId"    TEXT,
  "userId"     TEXT,
  "statusCode" INTEGER      NOT NULL,
  "durationMs" INTEGER      NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestLog_guildId_createdAt_idx" ON "RequestLog"("guildId", "createdAt");
CREATE INDEX "RequestLog_module_createdAt_idx"  ON "RequestLog"("module", "createdAt");
CREATE INDEX "RequestLog_createdAt_idx"         ON "RequestLog"("createdAt");
