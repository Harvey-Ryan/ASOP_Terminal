-- Add event-blueprint fields to EventTemplate
ALTER TABLE "EventTemplate" ADD COLUMN "musterPoint" TEXT;
ALTER TABLE "EventTemplate" ADD COLUMN "roles" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "EventTemplate" ADD COLUMN "vcNames" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "EventTemplate" ADD COLUMN "briefingChannel" BOOLEAN NOT NULL DEFAULT false;

-- Stable source-event link used as the upsert key (replaces name-based unique)
ALTER TABLE "EventTemplate" ADD COLUMN "sourceEventId" TEXT;
CREATE UNIQUE INDEX "EventTemplate_sourceEventId_key" ON "EventTemplate"("sourceEventId");

-- Usage tracking (mirrors RepeatTemplateUse)
CREATE TABLE "EventTemplateUse" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventTemplateUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventTemplateUse_templateId_usedAt_idx" ON "EventTemplateUse"("templateId", "usedAt");

ALTER TABLE "EventTemplateUse" ADD CONSTRAINT "EventTemplateUse_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "EventTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
