-- AlterTable: RSI handle per user
ALTER TABLE "User" ADD COLUMN "rsiHandle" TEXT;

-- CreateTable: FleetYards OAuth link
CREATE TABLE "FleetyardsLink" (
  "id"           TEXT         NOT NULL,
  "fyUserId"     TEXT         NOT NULL,
  "fyUsername"   TEXT         NOT NULL,
  "accessToken"  TEXT         NOT NULL,
  "refreshToken" TEXT,
  "expiresAt"    INTEGER,
  "lastSyncAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "userId"       TEXT         NOT NULL,
  CONSTRAINT "FleetyardsLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FleetyardsLink_userId_key" ON "FleetyardsLink"("userId");
CREATE INDEX "FleetyardsLink_fyUserId_idx"  ON "FleetyardsLink"("fyUserId");

-- AddForeignKey
ALTER TABLE "FleetyardsLink"
  ADD CONSTRAINT "FleetyardsLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
