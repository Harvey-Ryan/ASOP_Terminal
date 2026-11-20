import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findings } from '../schemaSafety.mjs';

test('an additive change has no findings', () => {
  const sql = `-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "jobsChannelId" TEXT;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- AlterEnum
ALTER TYPE "AarOutcome" ADD VALUE 'ABORTED';

-- CreateIndex
CREATE INDEX "Job_guildId_idx" ON "Job"("guildId");
`;
  assert.deepEqual(findings(sql), []);
  assert.deepEqual(findings(''), []);
});

test("Prisma's warnings are reported, wrapped bullets joined", () => {
  const sql = `/*
  Warnings:

  - You are about to drop the column \`nudges\` on the \`FleetOwner\` table. All the data in the column will be lost.
  - You are about to drop the \`FleetEntry\` table. If the table is not empty, all the data it contains will be
    lost.
  - Added the required column \`foo\` to the \`Bar\` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "FleetEntry" DROP CONSTRAINT "FleetEntry_guildId_fkey";

-- AlterTable
ALTER TABLE "FleetOwner" DROP COLUMN "nudges",
ADD COLUMN     "foo" TEXT NOT NULL;

-- DropTable
DROP TABLE "FleetEntry";
`;
  const f = findings(sql);
  assert.ok(f.includes('You are about to drop the column `nudges` on the `FleetOwner` table. All the data in the column will be lost.'));
  assert.ok(f.includes('You are about to drop the `FleetEntry` table. If the table is not empty, all the data it contains will be lost.'));
  assert.ok(f.some((x) => x.startsWith('Added the required column `foo`')));
  assert.ok(f.includes('Drops table "FleetEntry".'));
  assert.ok(f.includes('Drops column "nudges" from "FleetOwner".'));
});

test('drops and type changes are caught even without a warning block', () => {
  assert.deepEqual(findings('ALTER TABLE "Event" ALTER COLUMN "dkp" SET DATA TYPE BIGINT;'), ['Changes the type of "Event"."dkp".']);
  assert.deepEqual(findings('DROP TABLE "Old";'), ['Drops table "Old".']);
  assert.deepEqual(findings('DROP TYPE "Mood";'), ['Drops type "Mood".']);
});

test("an enum rewrite's own _old type isn't reported twice", () => {
  const sql = `/*
  Warnings:

  - The values [MAYBE] on the enum \`Rsvp\` will be removed. If these variants are still used in the database, this will fail.

*/
ALTER TYPE "Rsvp" RENAME TO "Rsvp_old";
CREATE TYPE "Rsvp" AS ENUM ('YES', 'NO');
DROP TYPE "Rsvp_old";
`;
  assert.deepEqual(findings(sql), [
    'The values [MAYBE] on the enum `Rsvp` will be removed. If these variants are still used in the database, this will fail.',
  ]);
});
