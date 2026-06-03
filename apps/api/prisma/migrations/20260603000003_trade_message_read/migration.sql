-- CreateTable
CREATE TABLE "TradeMessageRead" (
    "tradeId"    TEXT         NOT NULL,
    "userId"     TEXT         NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeMessageRead_pkey" PRIMARY KEY ("tradeId","userId")
);

-- CreateIndex
CREATE INDEX "TradeMessageRead_userId_idx" ON "TradeMessageRead"("userId");
