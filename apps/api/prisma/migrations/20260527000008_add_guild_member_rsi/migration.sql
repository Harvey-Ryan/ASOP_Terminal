-- AlterTable
ALTER TABLE "GuildMember"
  ADD COLUMN "rsiHandle"      TEXT,
  ADD COLUMN "rsiVerified"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rsiVerifyToken" TEXT;
