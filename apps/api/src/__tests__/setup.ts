import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach } from 'vitest';

const prisma = new PrismaClient();

// Wipe all data before each test in dependency order (children before parents)
beforeEach(async () => {
  await prisma.$transaction([
    prisma.dkpTransaction.deleteMany(),
    prisma.dkpBalance.deleteMany(),
    prisma.lootAssignment.deleteMany(),
    prisma.lootItem.deleteMany(),
    prisma.lootSession.deleteMany(),
    prisma.eventReminder.deleteMany(),
    prisma.eventRsvp.deleteMany(),
    prisma.event.deleteMany(),
    prisma.eventTemplate.deleteMany(),
    prisma.serverImage.deleteMany(),
    prisma.guildMember.deleteMany(),
    prisma.guildSettings.deleteMany(),
    prisma.account.deleteMany(),
    prisma.guild.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});
