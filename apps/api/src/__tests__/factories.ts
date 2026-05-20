import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let seq = 0;
function uid() { return `${Date.now()}-${++seq}`; }

export async function createUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      discordId: `discord-${uid()}`,
      username: 'testuser',
      discriminator: '0',
      ...overrides,
    },
  });
}

export async function createGuild(overrides: Record<string, unknown> = {}) {
  return prisma.guild.create({
    data: {
      guildId: `guild-${uid()}`,
      name: 'Test Guild',
      ...overrides,
    },
  });
}

export async function createGuildSettings(
  guildInternalId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.guildSettings.create({
    data: {
      guildId: guildInternalId,
      ...overrides,
    },
  });
}

export async function createEvent(
  guildDiscordId: string,
  createdByDiscordId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.event.create({
    data: {
      guildId: guildDiscordId,
      name: 'Test Event',
      startTime: new Date(Date.now() + 60 * 60_000),
      createdById: createdByDiscordId,
      status: 'PENDING',
      ...overrides,
    },
  });
}

export async function createLootSession(
  eventId: string,
  guildDiscordId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.lootSession.create({
    data: {
      eventId,
      guildId: guildDiscordId,
      ...overrides,
    },
  });
}

export async function createLootItem(
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.lootItem.create({
    data: {
      sessionId,
      name: 'Test Item',
      quantity: 1,
      sortOrder: 0,
      ...overrides,
    },
  });
}
