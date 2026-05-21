/**
 * One-time migration: read all data from the legacy SQLite dev.db and insert
 * into the PostgreSQL database. Idempotent — clears Postgres first so it can
 * be re-run safely if something goes wrong partway through.
 *
 * Run from the repo root:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DB_PATH = resolve(import.meta.dirname, '../apps/api/prisma/dev.db');

// Override DATABASE_URL in case the calling shell doesn't have it set
// (the API .env is the canonical source of truth for Postgres credentials)
process.env['DATABASE_URL'] ??= 'postgresql://dem:dem_dev_password@localhost:5434/dem';

const sqlite = new DatabaseSync(DB_PATH);
const prisma = new PrismaClient();

// SQLite stores booleans as 0/1 integers and nullable booleans as null/0/1.
function toBool(v: unknown): boolean { return Boolean(v); }
function toNullableBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Boolean(v);
}
function toNullableDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return new Date(v as string);
}
function toDate(v: unknown): Date { return new Date(v as string); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function all(table: string): any[] {
  return sqlite.prepare(`SELECT * FROM "${table}"`).all() as any[];
}

async function clearPostgres() {
  console.log('  Clearing Postgres tables in dependency order...');
  await prisma.dkpTransaction.deleteMany();
  await prisma.lootAssignment.deleteMany();
  await prisma.lootItem.deleteMany();
  await prisma.lootSession.deleteMany();
  await prisma.dkpBalance.deleteMany();
  await prisma.eventTemplate.deleteMany();
  await prisma.eventReminder.deleteMany();
  await prisma.eventRsvp.deleteMany();
  await prisma.serverImage.deleteMany();
  await prisma.event.deleteMany();
  await prisma.guildMember.deleteMany();
  await prisma.guildSettings.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.guild.deleteMany();
  console.log('  Done.');
}

async function main() {
  console.log(`\nMigrating SQLite → PostgreSQL`);
  console.log(`Source: ${DB_PATH}`);
  console.log(`Target: ${process.env['DATABASE_URL']}\n`);

  await clearPostgres();

  // ── Users ────────────────────────────────────────────────────────────────────

  const users = all('User');
  console.log(`Users: ${users.length}`);
  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id,
        discordId: u.discordId,
        username: u.username,
        discriminator: u.discriminator,
        globalName: u.globalName ?? null,
        avatar: u.avatar ?? null,
        email: u.email ?? null,
        createdAt: toDate(u.createdAt),
        updatedAt: toDate(u.updatedAt),
      },
    });
  }

  // ── Guilds ───────────────────────────────────────────────────────────────────

  const guilds = all('Guild');
  console.log(`Guilds: ${guilds.length}`);
  for (const g of guilds) {
    await prisma.guild.create({
      data: {
        id: g.id,
        guildId: g.guildId,
        name: g.name,
        icon: g.icon ?? null,
        createdAt: toDate(g.createdAt),
        updatedAt: toDate(g.updatedAt),
      },
    });
  }

  // ── Accounts ─────────────────────────────────────────────────────────────────

  const accounts = all('Account');
  console.log(`Accounts: ${accounts.length}`);
  for (const a of accounts) {
    await prisma.account.create({
      data: {
        id: a.id,
        provider: a.provider,
        providerAccountId: a.providerAccountId,
        accessToken: a.accessToken,
        refreshToken: a.refreshToken ?? null,
        expiresAt: a.expiresAt ?? null,
        tokenType: a.tokenType ?? null,
        scope: a.scope ?? null,
        userId: a.userId,
        createdAt: toDate(a.createdAt),
        updatedAt: toDate(a.updatedAt),
      },
    });
  }

  // ── GuildSettings ────────────────────────────────────────────────────────────

  const settings = all('GuildSettings');
  console.log(`GuildSettings: ${settings.length}`);
  for (const s of settings) {
    await prisma.guildSettings.create({
      data: {
        id: s.id,
        forumChannelId: s.forumChannelId ?? null,
        eventChannelId: s.eventChannelId ?? null,
        voiceCategoryId: s.voiceCategoryId ?? null,
        lootChannelId: s.lootChannelId ?? null,
        timezone: s.timezone,
        eventCreatorRoles: s.eventCreatorRoles,
        moduleEditorRoles: s.moduleEditorRoles,
        viewerRoles: s.viewerRoles,
        guildId: s.guildId,
        createdAt: toDate(s.createdAt),
        updatedAt: toDate(s.updatedAt),
      },
    });
  }

  // ── GuildMembers ─────────────────────────────────────────────────────────────

  const members = all('GuildMember');
  console.log(`GuildMembers: ${members.length}`);
  for (const m of members) {
    await prisma.guildMember.create({
      data: {
        id: m.id,
        role: m.role,
        userId: m.userId,
        guildId: m.guildId,
        createdAt: toDate(m.createdAt),
        updatedAt: toDate(m.updatedAt),
      },
    });
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  const events = all('Event');
  console.log(`Events: ${events.length}`);
  for (const e of events) {
    // Reset stale lastVcActivityAt for ACTIVE events that still have VCs — a stale
    // timestamp would cause the bot's inactivity checker to auto-end them immediately on restart.
    const isActiveWithVcs = e.status === 'ACTIVE' && e.vcIds !== '[]';
    await prisma.event.create({
      data: {
        id: e.id,
        guildId: e.guildId,
        name: e.name,
        description: e.description ?? null,
        musterPoint: e.musterPoint ?? null,
        startTime: toDate(e.startTime),
        endTime: toNullableDate(e.endTime),
        discordEventId: e.discordEventId ?? null,
        threadId: e.threadId ?? null,
        rosterMessageId: e.rosterMessageId ?? null,
        vcIds: e.vcIds,
        recurType: e.recurType ?? null,
        roles: e.roles,
        vcNames: e.vcNames,
        imageUrl: e.imageUrl ?? null,
        status: e.status,
        lastVcActivityAt: isActiveWithVcs ? new Date() : toNullableDate(e.lastVcActivityAt),
        hadLoot: toNullableBool(e.hadLoot),
        lootNotes: e.lootNotes ?? null,
        vcAttendees: e.vcAttendees,
        confirmedAttendees: e.confirmedAttendees ?? null,
        botCleanedUp: toBool(e.botCleanedUp),
        createdById: e.createdById,
        createdAt: toDate(e.createdAt),
        updatedAt: toDate(e.updatedAt),
      },
    });
  }

  // ── EventRsvps ───────────────────────────────────────────────────────────────

  const rsvps = all('EventRsvp');
  console.log(`EventRsvps: ${rsvps.length}`);
  for (const r of rsvps) {
    await prisma.eventRsvp.create({
      data: {
        id: r.id,
        eventId: r.eventId,
        userId: r.userId,
        username: r.username,
        role: r.role ?? null,
        updatedAt: toDate(r.updatedAt),
      },
    });
  }

  // ── EventReminders ───────────────────────────────────────────────────────────

  const reminders = all('EventReminder');
  console.log(`EventReminders: ${reminders.length}`);
  for (const r of reminders) {
    await prisma.eventReminder.create({
      data: {
        id: r.id,
        eventId: r.eventId,
        sendAt: toDate(r.sendAt),
        sent: toBool(r.sent),
        type: r.type,
      },
    });
  }

  // ── ServerImages ─────────────────────────────────────────────────────────────

  const images = all('ServerImage');
  console.log(`ServerImages: ${images.length}`);
  for (const img of images) {
    await prisma.serverImage.create({
      data: {
        id: img.id,
        guildId: img.guildId,
        filename: img.filename,
        url: img.url,
        createdAt: toDate(img.createdAt),
      },
    });
  }

  // ── LootSessions ─────────────────────────────────────────────────────────────

  const sessions = all('LootSession');
  console.log(`LootSessions: ${sessions.length}`);
  for (const s of sessions) {
    await prisma.lootSession.create({
      data: {
        id: s.id,
        eventId: s.eventId,
        guildId: s.guildId,
        method: s.method,
        status: s.status,
        draftOrder: s.draftOrder,
        dkpAward: s.dkpAward,
        createdAt: toDate(s.createdAt),
        updatedAt: toDate(s.updatedAt),
      },
    });
  }

  // ── LootItems ────────────────────────────────────────────────────────────────

  const items = all('LootItem');
  console.log(`LootItems: ${items.length}`);
  for (const item of items) {
    await prisma.lootItem.create({
      data: {
        id: item.id,
        sessionId: item.sessionId,
        name: item.name,
        quantity: item.quantity,
        excludePrevWinners: toBool(item.excludePrevWinners),
        sortOrder: item.sortOrder,
        createdAt: toDate(item.createdAt),
      },
    });
  }

  // ── LootAssignments ──────────────────────────────────────────────────────────

  const assignments = all('LootAssignment');
  console.log(`LootAssignments: ${assignments.length}`);
  for (const a of assignments) {
    await prisma.lootAssignment.create({
      data: {
        id: a.id,
        itemId: a.itemId,
        userId: a.userId,
        username: a.username,
        rollValue: a.rollValue ?? null,
        dkpSpent: a.dkpSpent ?? null,
        pickNumber: a.pickNumber ?? null,
        assignedAt: toDate(a.assignedAt),
      },
    });
  }

  // ── DkpBalances ──────────────────────────────────────────────────────────────

  const balances = all('DkpBalance');
  console.log(`DkpBalances: ${balances.length}`);
  for (const b of balances) {
    await prisma.dkpBalance.create({
      data: {
        id: b.id,
        guildId: b.guildId,
        userId: b.userId,
        username: b.username,
        balance: b.balance,
        updatedAt: toDate(b.updatedAt),
      },
    });
  }

  // ── DkpTransactions ──────────────────────────────────────────────────────────

  const transactions = all('DkpTransaction');
  console.log(`DkpTransactions: ${transactions.length}`);
  for (const t of transactions) {
    await prisma.dkpTransaction.create({
      data: {
        id: t.id,
        balanceId: t.balanceId,
        guildId: t.guildId,
        userId: t.userId,
        username: t.username,
        amount: t.amount,
        reason: t.reason,
        createdAt: toDate(t.createdAt),
      },
    });
  }

  // ── EventTemplates ───────────────────────────────────────────────────────────

  const templates = all('EventTemplate');
  console.log(`EventTemplates: ${templates.length}`);
  for (const t of templates) {
    await prisma.eventTemplate.create({
      data: {
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        imageUrl: t.imageUrl ?? null,
        rosterSlots: t.rosterSlots,
        reminderMinutes: t.reminderMinutes,
        defaultDuration: t.defaultDuration ?? null,
        isActive: toBool(t.isActive),
        guildId: t.guildId,
        createdById: t.createdById,
        createdAt: toDate(t.createdAt),
        updatedAt: toDate(t.updatedAt),
      },
    });
  }

  console.log('\nMigration complete.');
}

main()
  .catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
