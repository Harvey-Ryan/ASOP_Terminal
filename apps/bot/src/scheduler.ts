import cron from 'node-cron';
import { ChannelType } from 'discord.js';
import { prisma } from './db.js';
import { client } from './client.js';
import { setupDiscordForEvent, endEvent, resolveVcCategoryId } from './services/eventService.js';
import { formatMinutes } from './utils/time.js';
import type { EventRole } from '@dem/shared';

export function startScheduler() {
  cron.schedule('* * * * *', async () => {
    await checkPendingDiscordSetup().catch((e) => console.error('[bot] checkPendingDiscordSetup error:', e));
    await checkReminders().catch((e) => console.error('[bot] checkReminders error:', e));
    await checkVcCreation().catch((e) => console.error('[bot] checkVcCreation error:', e));
    await checkVcActivity().catch((e) => console.error('[bot] checkVcActivity error:', e));
    await checkInactivityEnd().catch((e) => console.error('[bot] checkInactivityEnd error:', e));
    await checkEndedEvents().catch((e) => console.error('[bot] checkEndedEvents error:', e));
  });
  console.log('[bot] Scheduler started');
}

// ── Discord setup for web-created events ─────────────────────────────────────

async function checkPendingDiscordSetup() {
  const pending = await prisma.event.findMany({
    where: { discordEventId: null, status: 'PENDING' },
    take: 5,
  });
  for (const event of pending) {
    await setupDiscordForEvent(event.id).catch((err) =>
      console.error(`[bot] Discord setup failed for event ${event.id}:`, err),
    );
  }
}

// ── Reminder dispatch ─────────────────────────────────────────────────────────

async function checkReminders() {
  const due = await prisma.eventReminder.findMany({
    where: { sent: false, sendAt: { lte: new Date() } },
    include: { event: { include: { rsvps: true } } },
  });

  for (const reminder of due) {
    const { event } = reminder;
    const minsLeft = Math.round((event.startTime.getTime() - Date.now()) / 60_000);
    const when = minsLeft > 0 ? `in ${formatMinutes(minsLeft)}` : 'now';
    const ts = Math.floor(event.startTime.getTime() / 1000);

    if (reminder.type === 'FORUM' && event.threadId) {
      try {
        const thread = await client.channels.fetch(event.threadId);
        if (thread?.isThread()) {
          await thread.send(
            `⏰ **Reminder:** **${event.name}** starts ${when}! (<t:${ts}:F>)`,
          );
        }
      } catch (err) {
        console.error(`[bot] Forum reminder failed for event ${event.id}:`, err);
      }
    }

    if (reminder.type === 'DM') {
      // Fetch current VC member IDs for this event
      const vcIds = JSON.parse(event.vcIds) as string[];
      const membersInVc = new Set<string>();

      for (const vcId of vcIds) {
        try {
          const ch = await client.channels.fetch(vcId);
          if (ch?.type === ChannelType.GuildVoice) {
            ch.members.forEach((m) => membersInVc.add(m.id));
          }
        } catch {
          // VC may not exist yet — that's fine
        }
      }

      // DM roster members who are NOT in a monitored VC
      for (const rsvp of event.rsvps) {
        if (membersInVc.has(rsvp.userId)) continue;
        try {
          const user = await client.users.fetch(rsvp.userId);
          await user.send(
            `⏰ **${event.name}** starts in 15 minutes! Join a voice channel to participate.\n📍 Muster Point: ${event.musterPoint ?? 'See event details'}`,
          );
        } catch {
          // DMs may be disabled — silently skip
        }
      }
    }

    await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sent: true } });
  }
}

// ── Voice channel creation (30 min before start) ──────────────────────────────

async function checkVcCreation() {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: {
      status: 'ACTIVE',
      vcIds: '[]',
      startTime: {
        gte: new Date(now.getTime() + 29 * 60_000),
        lte: new Date(now.getTime() + 31 * 60_000),
      },
    },
  });

  for (const event of events) {
    const vcNames = JSON.parse(event.vcNames) as string[];
    if (vcNames.length === 0) continue;

    try {
      const guild = await client.guilds.fetch(event.guildId);
      const categoryId = await resolveVcCategoryId(event.guildId);
      const createdIds: string[] = [];

      for (const vcName of vcNames) {
        const vc = await guild.channels.create({
          name: `🎙️ ${vcName}`,
          type: ChannelType.GuildVoice,
          ...(categoryId ? { parent: categoryId } : {}),
        });
        createdIds.push(vc.id);
      }

      await prisma.event.update({
        where: { id: event.id },
        data: { vcIds: JSON.stringify(createdIds), lastVcActivityAt: new Date() },
      });

      if (event.threadId && createdIds.length > 0) {
        const thread = await client.channels.fetch(event.threadId);
        if (thread?.isThread()) {
          const mentions = createdIds.map((id) => `<#${id}>`).join(', ');
          const ts = Math.floor(event.startTime.getTime() / 1000);
          await thread.send(
            `🎙️ Voice channels ready for **${event.name}**! Join: ${mentions} — event starts <t:${ts}:R>`,
          );
        }
      }
    } catch (err) {
      console.error(`[bot] VC creation failed for event ${event.id}:`, err);
    }
  }
}

// ── VC presence / activity tracking ──────────────────────────────────────────

async function checkVcActivity() {
  const events = await prisma.event.findMany({
    where: { status: 'ACTIVE' },
  });

  for (const event of events) {
    const vcIds = JSON.parse(event.vcIds) as string[];
    if (vcIds.length === 0) continue;

    let anyPresent = false;
    for (const vcId of vcIds) {
      try {
        const ch = await client.channels.fetch(vcId);
        if (ch?.type === ChannelType.GuildVoice && ch.members.size > 0) {
          anyPresent = true;
          break;
        }
      } catch {
        // Channel deleted or unavailable
      }
    }

    if (anyPresent) {
      await prisma.event.update({
        where: { id: event.id },
        data: { lastVcActivityAt: new Date() },
      });
    }
  }
}

// ── Inactivity auto-end (30 min with no VC presence after VCs were created) ───

async function checkInactivityEnd() {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const events = await prisma.event.findMany({
    where: {
      status: 'ACTIVE',
      lastVcActivityAt: { not: null, lte: cutoff },
    },
  });

  for (const event of events) {
    const vcIds = JSON.parse(event.vcIds) as string[];
    if (vcIds.length === 0) continue; // only apply to events that had VCs

    console.log(`[bot] Auto-ending event ${event.id} (${event.name}) due to VC inactivity`);
    await prisma.event.update({ where: { id: event.id }, data: { status: 'ENDED' } });
  }
}

// ── Process ENDED events (delete VCs, complete Discord event, loot prompt) ───

async function checkEndedEvents() {
  const ended = await prisma.event.findMany({
    where: { status: 'ENDED', botCleanedUp: false },
    take: 5,
  });

  for (const event of ended) {
    await endEvent(event.id).catch((err) =>
      console.error(`[bot] endEvent failed for ${event.id}:`, err),
    );
  }
}

