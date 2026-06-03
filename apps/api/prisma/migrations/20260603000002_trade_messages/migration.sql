-- CreateTable: TradeMessage
CREATE TABLE "TradeMessage" (
    "id"             TEXT         NOT NULL,
    "tradeId"        TEXT         NOT NULL,
    "senderId"       TEXT         NOT NULL,
    "senderUsername" TEXT         NOT NULL,
    "body"           TEXT         NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TradeMessage" ADD CONSTRAINT "TradeMessage_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "Trade"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "TradeMessage_tradeId_createdAt_idx" ON "TradeMessage"("tradeId", "createdAt");
