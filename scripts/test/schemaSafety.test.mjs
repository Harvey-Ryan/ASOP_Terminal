import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findings } from '../schemaSafety.mjs';

test('an additive change has no findings', () => {
  // Shapes from real ASOP diffs (v1.56.0's AI assistant tables).
  const sql = `-- AlterTable
ALTER TABLE "AdminConfig" ADD COLUMN     "aiDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiDisabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiAssistant" (
    "guildId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    CONSTRAINT "AiAssistant_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAssistant_guildId_key" ON "AiAssistant"("guildId");

-- AlterEnum
ALTER TYPE "AarOutcome" ADD VALUE 'ABORTED';

-- CreateIndex
CREATE INDEX "Job_guildId_idx" ON "Job"("guildId");

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
`;
  assert.deepEqual(findings(sql), []);
  assert.deepEqual(findings(''), []);
});

test('dropped tables (the real v1.35.1 fleet clean-up)', () => {
  const sql = `-- DropForeignKey
ALTER TABLE "FleetyardsLink" DROP CONSTRAINT "FleetyardsLink_userId_fkey";

-- DropTable
DROP TABLE "FleetEntry";

-- DropTable
DROP TABLE "FleetyardsLink";
`;
  assert.deepEqual(findings(sql), [
    'Drops table "FleetEntry" and all its rows.',
    'Drops table "FleetyardsLink" and all its rows.',
  ]);
});

test('every clause of a combined ALTER TABLE is read', () => {
  const sql = `ALTER TABLE "FleetOwner" DROP COLUMN "nudges",
DROP COLUMN "legacy",
ADD COLUMN     "foo" TEXT NOT NULL,
ADD COLUMN     "bar" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "checkedAt" SET NOT NULL,
ALTER COLUMN "count" SET DATA TYPE BIGINT;`;
  assert.deepEqual(findings(sql), [
    'Drops column "nudges" from "FleetOwner", with its data.',
    'Drops column "legacy" from "FleetOwner", with its data.',
    'Adds required column "FleetOwner"."foo" without a default: fails if the table has rows.',
    'Makes "FleetOwner"."checkedAt" required: fails if any row has no value.',
    'Changes the type of "FleetOwner"."count".',
  ]);
});

test('enum values removed, and new unique indexes on existing tables', () => {
  const sql = `-- AlterEnum
BEGIN;
CREATE TYPE "Rsvp_new" AS ENUM ('YES', 'NO');
ALTER TABLE "EventRsvp" ALTER COLUMN "status" TYPE "Rsvp_new" USING ("status"::text::"Rsvp_new");
ALTER TYPE "Rsvp" RENAME TO "Rsvp_old";
ALTER TYPE "Rsvp_new" RENAME TO "Rsvp";
DROP TYPE "Rsvp_old";
COMMIT;

-- CreateIndex
CREATE UNIQUE INDEX "Job_slug_key" ON "Job"("slug");
`;
  assert.deepEqual(findings(sql), [
    'Rewrites enum "Rsvp" (values removed or renamed): fails if rows still use them.',
    'Adds unique index "Job_slug_key" on "Job": fails if existing rows have duplicates.',
  ]);
});

test("Prisma's Warnings block is reported when present, wrapped bullets joined", () => {
  const sql = `/*
  Warnings:

  - You are about to drop the \`FleetEntry\` table. If the table is not empty, all the data it contains will be
    lost.

*/
DROP TABLE "FleetEntry";
`;
  assert.deepEqual(findings(sql), [
    'You are about to drop the `FleetEntry` table. If the table is not empty, all the data it contains will be lost.',
    'Drops table "FleetEntry" and all its rows.',
  ]);
});
