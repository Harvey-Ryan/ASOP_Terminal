/**
 * Idempotent migration: LootAuction, LootAuctionBid, Auction, AuctionBid tables.
 *
 * HOW TO RUN:
 *   cd apps/api && npx tsx scripts/migrate-auctions.ts
 *
 * SAFE TO RUN ON EVERY DEPLOY:
 *   Each table is guarded by an information_schema check — if it already exists
 *   the CREATE is skipped entirely. No state is modified if all tables are present.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<[{ exists: boolean }][]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = ${name}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<[{ exists: boolean }][]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = ${table}
        AND column_name  = ${column}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

function log(msg: string) {
  console.log(`[migrate-auctions] ${msg}`);
}

async function createLootAuctionTables() {
  log('Creating LootAuction table…');
  await prisma.$executeRaw`
    CREATE TABLE "LootAuction" (
      "id"               TEXT         NOT NULL,
      "itemId"           TEXT         NOT NULL,
      "sessionId"        TEXT         NOT NULL,
      "guildId"          TEXT         NOT NULL,
      "startedById"      TEXT         NOT NULL,
      "durationSecs"     INTEGER      NOT NULL DEFAULT 120,
      "closesAt"         TIMESTAMP(3) NOT NULL,
      "status"           TEXT         NOT NULL DEFAULT 'OPEN',
      "winnerId"         TEXT,
      "winnerUsername"   TEXT,
      "winningBid"       INTEGER,
      "discordMessageId" TEXT,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "LootAuction_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX "LootAuction_itemId_key" ON "LootAuction"("itemId")
  `;
  await prisma.$executeRaw`
    CREATE INDEX "LootAuction_guildId_status_idx" ON "LootAuction"("guildId", "status")
  `;
  await prisma.$executeRaw`
    CREATE INDEX "LootAuction_closesAt_status_idx" ON "LootAuction"("closesAt", "status")
  `;
  await prisma.$executeRaw`
    ALTER TABLE "LootAuction"
      ADD CONSTRAINT "LootAuction_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "LootItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  `;
  log('✅ LootAuction created.');

  log('Creating LootAuctionBid table…');
  await prisma.$executeRaw`
    CREATE TABLE "LootAuctionBid" (
      "id"        TEXT         NOT NULL,
      "auctionId" TEXT         NOT NULL,
      "userId"    TEXT         NOT NULL,
      "username"  TEXT         NOT NULL,
      "amount"    INTEGER      NOT NULL,
      "maxBid"    INTEGER      NOT NULL DEFAULT 0,
      "placedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "LootAuctionBid_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX "LootAuctionBid_auctionId_userId_key"
      ON "LootAuctionBid"("auctionId", "userId")
  `;
  await prisma.$executeRaw`
    CREATE INDEX "LootAuctionBid_auctionId_idx" ON "LootAuctionBid"("auctionId")
  `;
  await prisma.$executeRaw`
    ALTER TABLE "LootAuctionBid"
      ADD CONSTRAINT "LootAuctionBid_auctionId_fkey"
      FOREIGN KEY ("auctionId") REFERENCES "LootAuction"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  `;
  log('✅ LootAuctionBid created.');
}

async function createStandaloneAuctionTables() {
  log('Creating Auction table…');
  await prisma.$executeRaw`
    CREATE TABLE "Auction" (
      "id"               TEXT         NOT NULL,
      "guildId"          TEXT         NOT NULL,
      "title"            TEXT         NOT NULL,
      "description"      TEXT,
      "startedById"      TEXT         NOT NULL,
      "durationSecs"     INTEGER      NOT NULL DEFAULT 120,
      "closesAt"         TIMESTAMP(3) NOT NULL,
      "status"           TEXT         NOT NULL DEFAULT 'OPEN',
      "winnerId"         TEXT,
      "winnerUsername"   TEXT,
      "winningBid"       INTEGER,
      "discordMessageId" TEXT,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`
    CREATE INDEX "Auction_guildId_status_idx" ON "Auction"("guildId", "status")
  `;
  await prisma.$executeRaw`
    CREATE INDEX "Auction_closesAt_status_idx" ON "Auction"("closesAt", "status")
  `;
  log('✅ Auction created.');

  log('Creating AuctionBid table…');
  await prisma.$executeRaw`
    CREATE TABLE "AuctionBid" (
      "id"        TEXT         NOT NULL,
      "auctionId" TEXT         NOT NULL,
      "userId"    TEXT         NOT NULL,
      "username"  TEXT         NOT NULL,
      "amount"    INTEGER      NOT NULL,
      "placedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX "AuctionBid_auctionId_userId_key"
      ON "AuctionBid"("auctionId", "userId")
  `;
  await prisma.$executeRaw`
    CREATE INDEX "AuctionBid_auctionId_idx" ON "AuctionBid"("auctionId")
  `;
  await prisma.$executeRaw`
    ALTER TABLE "AuctionBid"
      ADD CONSTRAINT "AuctionBid_auctionId_fkey"
      FOREIGN KEY ("auctionId") REFERENCES "Auction"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  `;
  log('✅ AuctionBid created.');
}

async function main() {
  const [lootAuctionExists, auctionExists] = await Promise.all([
    tableExists('LootAuction'),
    tableExists('Auction'),
  ]);

  let anyWork = false;

  if (lootAuctionExists) {
    log('LootAuction already exists — skipping.');
  } else {
    await createLootAuctionTables();
    anyWork = true;
  }

  // If LootAuctionBid exists but is missing the maxBid column, add it now
  const lootAuctionBidExists = await tableExists('LootAuctionBid');
  if (lootAuctionBidExists) {
    const maxBidExists = await columnExists('LootAuctionBid', 'maxBid');
    if (!maxBidExists) {
      log('Adding maxBid column to LootAuctionBid…');
      await prisma.$executeRaw`ALTER TABLE "LootAuctionBid" ADD COLUMN "maxBid" INTEGER NOT NULL DEFAULT 0`;
      await prisma.$executeRaw`UPDATE "LootAuctionBid" SET "maxBid" = "amount"`;
      log('✅ maxBid column added to LootAuctionBid.');
      anyWork = true;
    }
  }

  if (auctionExists) {
    log('Auction already exists — skipping.');
  } else {
    await createStandaloneAuctionTables();
    anyWork = true;
  }

  if (!anyWork) {
    log('All tables already present. Nothing to do.');
  } else {
    log('Migration complete.');
  }
}

main()
  .catch((err: unknown) => {
    console.error('[migrate-auctions] FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
