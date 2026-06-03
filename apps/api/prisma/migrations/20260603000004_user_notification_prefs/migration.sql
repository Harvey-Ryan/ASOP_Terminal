-- CreateTable
CREATE TABLE "UserNotificationPrefs" (
    "userId"           TEXT    NOT NULL,
    "dmTradeRequest"   BOOLEAN NOT NULL DEFAULT true,
    "dmTradeStatus"    BOOLEAN NOT NULL DEFAULT true,
    "dmTradeCancelled" BOOLEAN NOT NULL DEFAULT true,
    "dmTradeMessage"   BOOLEAN NOT NULL DEFAULT true,
    "dmEventReminder"  BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserNotificationPrefs_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserNotificationPrefs" ADD CONSTRAINT "UserNotificationPrefs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
