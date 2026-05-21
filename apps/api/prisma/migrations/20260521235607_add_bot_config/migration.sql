-- CreateTable
CREATE TABLE "BotConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "globalCommandsEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);
