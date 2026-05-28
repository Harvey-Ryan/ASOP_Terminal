-- CreateTable
CREATE TABLE "ScMission" (
    "uuid"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT,
    "faction"      TEXT,
    "missionType"  TEXT,
    "missionGiver" TEXT,
    "locationName" TEXT,
    "syncedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScMission_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "ScMissionRewardPool" (
    "id"          TEXT NOT NULL,
    "missionUuid" TEXT NOT NULL,
    "poolUuid"    TEXT NOT NULL,

    CONSTRAINT "ScMissionRewardPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScMission_name_idx" ON "ScMission"("name");
CREATE INDEX "ScMission_faction_idx" ON "ScMission"("faction");
CREATE UNIQUE INDEX "ScMissionRewardPool_missionUuid_poolUuid_key" ON "ScMissionRewardPool"("missionUuid", "poolUuid");
CREATE INDEX "ScMissionRewardPool_missionUuid_idx" ON "ScMissionRewardPool"("missionUuid");
CREATE INDEX "ScMissionRewardPool_poolUuid_idx" ON "ScMissionRewardPool"("poolUuid");

-- AddForeignKey
ALTER TABLE "ScMissionRewardPool" ADD CONSTRAINT "ScMissionRewardPool_missionUuid_fkey"
    FOREIGN KEY ("missionUuid") REFERENCES "ScMission"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
