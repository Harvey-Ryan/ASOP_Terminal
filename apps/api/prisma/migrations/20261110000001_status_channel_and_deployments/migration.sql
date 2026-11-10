-- Live status embed channel (per guild) and bot-managed message tracking
ALTER TABLE "GuildSettings" ADD COLUMN "statusChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "statusMessageId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "statusMessageChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "statusEmbedHash" TEXT;

-- When each ASOP version first ran in production
CREATE TABLE "AppDeployment" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppDeployment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppDeployment_version_commitSha_key" ON "AppDeployment"("version", "commitSha");
