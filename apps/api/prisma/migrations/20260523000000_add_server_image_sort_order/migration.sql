ALTER TABLE "ServerImage" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "ServerImage_guildId_sortOrder_idx" ON "ServerImage"("guildId", "sortOrder");
