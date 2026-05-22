/**
 * One-time migration: LootAuction + LootAuctionBid tables.
 *
 * HOW TO RUN (Railway one-off command or local):
 *   cd apps/api && npx tsx scripts/migrate-loot-auction.ts
 *
 * SELF-DISABLING BEHAVIOUR:
 *   1. Database guard (durable across redeployments):
 *      Checks information_schema before doing anything. If LootAuction
 *      already exists the script exits 0 without touching the DB.
 *   2. Filesystem guard (in-process / same container run):
 *      Renames this file to migrate-loot-auction.done.ts so it can't be
 *      triggered by accident again in the same filesystem state.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { renameSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const prisma = new PrismaClient();

// ── helpers ───────────────────────────────────────────────────────────────────

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

function log(msg: string) {
  console.log(`[migrate-loot-auction] ${msg}`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Database guard — durable across Railway redeployments ─────────────
  if (await tableExists('LootAuction')) {
    log('LootAuction table already exists — migration already applied. Nothing to do.');
    log('Self-disabling (rename) skipped since DB check is the authoritative guard.');
    return;
  }

  log('LootAuction table not found. Running migration…');

  // ── 2. DDL — single transaction ───────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // LootAuction
    await tx.$executeRaw`
      CREATE TABLE "LootAuction" (
        "id"               TEXT        NOT NULL,
        "itemId"           TEXT        NOT NULL,
        "sessionId"        TEXT        NOT NULL,
        "guildId"          TEXT        NOT NULL,
        "startedById"      TEXT        NOT NULL,
        "durationSecs"     INTEGER     NOT NULL DEFAULT 120,
        "closesAt"         TIMESTAMP(3) NOT NULL,
        "status"           TEXT        NOT NULL DEFAULT 'OPEN',
        "winnerId"         TEXT,
        "winnerUsername"   TEXT,
        "winningBid"       INTEGER,
        "discordMessageId" TEXT,
        "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LootAuction_pkey" PRIMARY KEY ("id")
      )
    `;

    await tx.$executeRaw`
      CREATE UNIQUE INDEX "LootAuction_itemId_key"
        ON "LootAuction"("itemId")
    `;
    await tx.$executeRaw`
      CREATE INDEX "LootAuction_guildId_status_idx"
        ON "LootAuction"("guildId", "status")
    `;
    await tx.$executeRaw`
      CREATE INDEX "LootAuction_closesAt_status_idx"
        ON "LootAuction"("closesAt", "status")
    `;
    await tx.$executeRaw`
      ALTER TABLE "LootAuction"
        ADD CONSTRAINT "LootAuction_itemId_fkey"
        FOREIGN KEY ("itemId")
        REFERENCES "LootItem"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // LootAuctionBid
    await tx.$executeRaw`
      CREATE TABLE "LootAuctionBid" (
        "id"        TEXT        NOT NULL,
        "auctionId" TEXT        NOT NULL,
        "userId"    TEXT        NOT NULL,
        "username"  TEXT        NOT NULL,
        "amount"    INTEGER     NOT NULL,
        "placedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LootAuctionBid_pkey" PRIMARY KEY ("id")
      )
    `;
    await tx.$executeRaw`
      CREATE UNIQUE INDEX "LootAuctionBid_auctionId_userId_key"
        ON "LootAuctionBid"("auctionId", "userId")
    `;
    await tx.$executeRaw`
      CREATE INDEX "LootAuctionBid_auctionId_idx"
        ON "LootAuctionBid"("auctionId")
    `;
    await tx.$executeRaw`
      ALTER TABLE "LootAuctionBid"
        ADD CONSTRAINT "LootAuctionBid_auctionId_fkey"
        FOREIGN KEY ("auctionId")
        REFERENCES "LootAuction"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    `;
  });

  // ── 3. Verify both tables exist ───────────────────────────────────────────
  const [auctionOk, bidOk] = await Promise.all([
    tableExists('LootAuction'),
    tableExists('LootAuctionBid'),
  ]);

  if (!auctionOk || !bidOk) {
    throw new Error(
      `Verification failed — missing: ${[!auctionOk && 'LootAuction', !bidOk && 'LootAuctionBid'].filter(Boolean).join(', ')}`,
    );
  }

  log('✅ LootAuction created and verified.');
  log('✅ LootAuctionBid created and verified.');

  // ── 4. Filesystem guard — rename script so it can't be re-triggered ───────
  // This is ephemeral (Railway containers reset on redeploy) but prevents
  // accidental re-runs during the same deployment.
  const donePath = __filename.replace(/\.ts$/, '.done.ts');
  try {
    if (!existsSync(donePath)) {
      renameSync(__filename, donePath);
      log(`Script renamed → ${path.basename(donePath)}`);
      log('The DB existence check above is the durable guard across redeployments.');
    }
  } catch (err) {
    log(`Could not rename script (non-fatal): ${(err as Error).message}`);
  }

  log('Migration complete.');
}

main()
  .catch((err: unknown) => {
    console.error('[migrate-loot-auction] FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
