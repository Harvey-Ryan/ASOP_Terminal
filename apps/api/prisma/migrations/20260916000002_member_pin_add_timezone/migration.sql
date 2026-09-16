-- AlterTable: add IANA timezone column to MemberPin (nullable, populated at pin-save time)
ALTER TABLE "MemberPin" ADD COLUMN "timezone" TEXT;
