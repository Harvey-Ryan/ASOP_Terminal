-- AlterTable: remove DKP prize columns from Tournament
ALTER TABLE "Tournament" DROP COLUMN IF EXISTS "dkpPrize1st";
ALTER TABLE "Tournament" DROP COLUMN IF EXISTS "dkpPrize2nd";
ALTER TABLE "Tournament" DROP COLUMN IF EXISTS "dkpPrize3rd";

-- AlterTable: add ELO visibility toggle to GuildSettings
ALTER TABLE "GuildSettings" ADD COLUMN "tournamentHideElo" BOOLEAN NOT NULL DEFAULT false;
