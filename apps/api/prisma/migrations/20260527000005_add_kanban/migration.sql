-- CreateTable: KanbanColumn
CREATE TABLE "KanbanColumn" (
  "id"        TEXT         NOT NULL,
  "title"     TEXT         NOT NULL,
  "color"     TEXT         NOT NULL DEFAULT 'slate',
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KanbanColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable: KanbanCard
CREATE TABLE "KanbanCard" (
  "id"          TEXT         NOT NULL,
  "columnId"    TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KanbanCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KanbanColumn_sortOrder_idx" ON "KanbanColumn"("sortOrder");
CREATE INDEX "KanbanCard_columnId_sortOrder_idx" ON "KanbanCard"("columnId", "sortOrder");

-- AddForeignKey
ALTER TABLE "KanbanCard"
  ADD CONSTRAINT "KanbanCard_columnId_fkey"
  FOREIGN KEY ("columnId") REFERENCES "KanbanColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
