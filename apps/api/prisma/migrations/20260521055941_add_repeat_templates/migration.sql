-- CreateTable
CREATE TABLE "RepeatTemplate" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "musterPoint" TEXT,
    "roles" TEXT NOT NULL DEFAULT '[]',
    "vcNames" TEXT NOT NULL DEFAULT '[]',
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepeatTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepeatTemplateUse" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepeatTemplateUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepeatTemplate_guildId_idx" ON "RepeatTemplate"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "RepeatTemplate_guildId_name_key" ON "RepeatTemplate"("guildId", "name");

-- CreateIndex
CREATE INDEX "RepeatTemplateUse_templateId_usedAt_idx" ON "RepeatTemplateUse"("templateId", "usedAt");

-- AddForeignKey
ALTER TABLE "RepeatTemplateUse" ADD CONSTRAINT "RepeatTemplateUse_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RepeatTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
