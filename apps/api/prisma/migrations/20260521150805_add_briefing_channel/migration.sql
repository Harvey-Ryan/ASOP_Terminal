-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "briefingChannel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RepeatTemplate" ADD COLUMN     "briefingChannel" BOOLEAN NOT NULL DEFAULT false;
