-- Link EventAllianceGuild to the EventGuildShare that triggered its Discord setup.
-- Nullable so existing rows (created before this field was added) are unaffected.
-- UNIQUE enforces one share → at most one EventAllianceGuild row.
-- ON DELETE SET NULL: deleting the share preserves the record so Discord entities
-- (thread / scheduled event) can still be found and archived before removal.
ALTER TABLE "EventAllianceGuild" ADD COLUMN "shareId" TEXT;
ALTER TABLE "EventAllianceGuild" ADD CONSTRAINT "EventAllianceGuild_shareId_key" UNIQUE ("shareId");
ALTER TABLE "EventAllianceGuild" ADD CONSTRAINT "EventAllianceGuild_shareId_fkey"
  FOREIGN KEY ("shareId") REFERENCES "EventGuildShare"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
