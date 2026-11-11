-- Clean-up step 2: the old alliance tables. Only safe once step 1 has run in
-- production (its start-up conversion leaves no Event."allianceId" set and no
-- ALLIANCE shares). On Railway, `prisma db push --accept-data-loss` makes these
-- changes on start; this file records them.
DROP INDEX IF EXISTS "Event_allianceId_idx";
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_allianceId_fkey";
ALTER TABLE "Event" DROP COLUMN IF EXISTS "allianceId";
ALTER TABLE "EventGuildShare" DROP COLUMN IF EXISTS "allianceId";
DROP TABLE IF EXISTS "AllianceMember", "Alliance";
ALTER TYPE "ShareSource" RENAME TO "ShareSource_old";
CREATE TYPE "ShareSource" AS ENUM ('DIRECT');
ALTER TABLE "EventGuildShare" ALTER COLUMN "sourceType" TYPE "ShareSource" USING ("sourceType"::text::"ShareSource");
DROP TYPE "ShareSource_old";
