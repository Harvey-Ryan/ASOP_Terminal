-- AlterTable AllianceMember: add status and invitedByGuildId
-- Existing rows default to 'ACCEPTED' (they were directly added before the proposal flow).
ALTER TABLE "AllianceMember" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACCEPTED';
ALTER TABLE "AllianceMember" ADD COLUMN "invitedByGuildId" TEXT;

-- CreateIndex
CREATE INDEX "AllianceMember_status_idx" ON "AllianceMember"("status");
