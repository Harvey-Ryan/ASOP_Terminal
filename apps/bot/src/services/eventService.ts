import {
  AttachmentBuilder,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import type { ForumChannel } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { buildRosterEmbed, buildRoleButtons } from '../utils/embeds.js';
import { nextOccurrence } from '../utils/time.js';
import type { EventRole } from '@dem/shared';

// ── Setup Discord entities for a pending web-created event ────────────────────

export async function setupDiscordForEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { rsvps: true },
  });

  const guild = await client.guilds.fetch(event.guildId);
  const roles = JSON.parse(event.roles) as EventRole[];
  let { discordEventId, threadId, rosterMessageId } = event;

  // ── Forum thread ──────────────────────────────────────────────────────────

  if (!threadId) {
    const forumChannelId = await resolveForumChannelId(event.guildId);
    if (forumChannelId) {
      try {
        const ch = await client.channels.fetch(forumChannelId);
        if (ch?.type === ChannelType.GuildForum) {
          const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
          const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename);
          const components = buildRoleButtons(event.id, roles);
          const thread = await (ch as ForumChannel).threads.create({
            name: event.name,
            message: {
              embeds: [embed],
              components,
              files: imageAttachment ? [imageAttachment.builder] : [],
            },
          });
          threadId = thread.id;
          // The starter message is the first message in the thread
          const starter = await thread.fetchStarterMessage();
          rosterMessageId = starter?.id ?? null;
          // Persist immediately so any concurrent Interested clicks can post to the thread
          await prisma.event.update({ where: { id: event.id }, data: { threadId, rosterMessageId } });
        }
      } catch (err) {
        console.error('[bot] Failed to create forum thread:', err);
      }
    }
  }

  // ── Discord Scheduled Event ───────────────────────────────────────────────

  if (!discordEventId && event.startTime > new Date()) {
    try {
      let imageDataUri: string | undefined;
      if (event.imageUrl) {
        imageDataUri = await fetchImageAsDataUri(event.imageUrl);
      }

      // External events require an end time — default to start + 2 hours
      const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);

      const scheduled = await guild.scheduledEvents.create({
        name: event.name,
        description: event.description ?? undefined,
        scheduledStartTime: event.startTime,
        scheduledEndTime,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: event.musterPoint ?? event.name },
        ...(imageDataUri ? { image: imageDataUri } : {}),
      });
      discordEventId = scheduled.id;
      // Persist immediately — GuildScheduledEventUserAdd can fire within milliseconds
      await prisma.event.update({ where: { id: event.id }, data: { discordEventId } });
    } catch (err) {
      console.error('[bot] Failed to create Discord scheduled event:', err);
    }
  }

  // ── Immediate VC creation (start < 30 min away) ──────────────────────────

  const vcNames = JSON.parse(event.vcNames) as string[];
  let vcIds: string[] = JSON.parse(event.vcIds);
  let lastVcActivityAt: Date | undefined;

  if (vcNames.length > 0 && vcIds.length === 0 && event.startTime.getTime() - Date.now() < 30 * 60_000) {
    try {
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

      vcIds = createdIds;
      lastVcActivityAt = new Date();

      if (threadId && createdIds.length > 0) {
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (thread?.isThread()) {
          const mentions = createdIds.map((id) => `<#${id}>`).join(', ');
          const ts = Math.floor(event.startTime.getTime() / 1000);
          await thread.send(
            `🎙️ Voice channels ready for **${event.name}**! Join: ${mentions} — event starts <t:${ts}:R>`,
          );
        }
      }
    } catch (err) {
      console.error('[bot] Failed to create VCs immediately:', err);
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      discordEventId,
      threadId,
      rosterMessageId,
      status: 'ACTIVE',
      ...(vcIds.length > 0 ? { vcIds: JSON.stringify(vcIds) } : {}),
      ...(lastVcActivityAt ? { lastVcActivityAt } : {}),
    },
  });
}

// ── Update the roster embed after any RSVP change ─────────────────────────────

export async function updateRosterEmbed(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event?.threadId) return;

  const roles = JSON.parse(event.roles) as EventRole[];
  const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
  const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename);
  const components = buildRoleButtons(event.id, roles);
  const files = imageAttachment ? [imageAttachment.builder] : [];

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (!thread?.isThread()) return;

    if (event.rosterMessageId) {
      const msg = await thread.messages.fetch(event.rosterMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components, files });
        return;
      }
    }

    // Fallback: edit starter message
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await starter.edit({ embeds: [embed], components, files });
  } catch (err) {
    console.error('[bot] Failed to update roster embed:', err);
  }
}

// ── End event (called by scheduler after status=ENDED is detected) ────────────

export async function endEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { rsvps: true },
  });

  // Collect active VC members BEFORE deleting channels
  const vcIds = JSON.parse(event.vcIds) as string[];
  const activeUserIds = new Set<string>();

  if (vcIds.length > 0) {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      for (const vcId of vcIds) {
        const vc = await guild.channels.fetch(vcId).catch(() => null);
        if (vc?.type === ChannelType.GuildVoice) {
          vc.members.forEach((m) => activeUserIds.add(m.id));
        }
        if (vc) await vc.delete().catch(() => null);
      }
    } catch (err) {
      console.error('[bot] Failed to delete VCs:', err);
    }
  }

  // Delete the Discord Scheduled Event
  if (event.discordEventId) {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      await guild.scheduledEvents.delete(event.discordEventId).catch(() => null);
    } catch (err) {
      console.error('[bot] Failed to delete Discord scheduled event:', err);
    }
  }

  // Update embed with VC attendance + remove buttons, then archive thread
  if (event.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        const rosterMsg = event.rosterMessageId
          ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);
        if (rosterMsg) {
          const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
          const updatedEmbed = buildRosterEmbed(event, activeUserIds, imageAttachment?.filename);
          const files = imageAttachment ? [imageAttachment.builder] : [];
          await rosterMsg.edit({ embeds: [updatedEmbed], components: [], files }).catch(() => null);
        }

        await thread.send(`🏁 **${event.name}** has ended.`);
        await thread.setArchived(true).catch(() => null);
      }
    } catch (err) {
      console.error('[bot] Failed to archive forum thread:', err);
    }
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      vcIds: '[]',
      vcAttendees: JSON.stringify([...activeUserIds]),
      botCleanedUp: true,
    },
  });

  if (event.recurType) {
    await spawnNextRecurrence(event.id).catch((err) =>
      console.error(`[bot] spawnNextRecurrence failed for ${event.id}:`, err),
    );
    await prisma.event.update({ where: { id: event.id }, data: { recurType: null } });
  }
}

// ── Recurring event spawning ──────────────────────────────────────────────────

export async function spawnNextRecurrence(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (!event.recurType) return;

  const nextStart = nextOccurrence(event.startTime, event.recurType);
  const nextEnd = event.endTime ? nextOccurrence(event.endTime, event.recurType) : null;
  const now = new Date();

  const next = await prisma.event.create({
    data: {
      guildId: event.guildId,
      name: event.name,
      description: event.description,
      musterPoint: event.musterPoint,
      startTime: nextStart,
      endTime: nextEnd,
      recurType: event.recurType,
      roles: event.roles,
      vcNames: event.vcNames,
      imageUrl: event.imageUrl,
      createdById: event.createdById,
      status: 'PENDING',
    },
  });

  const reminders = [
    { eventId: next.id, sendAt: new Date(nextStart.getTime() - 60 * 60_000), type: 'FORUM' },
    { eventId: next.id, sendAt: new Date(nextStart.getTime() - 30 * 60_000), type: 'FORUM' },
    { eventId: next.id, sendAt: new Date(nextStart.getTime() - 15 * 60_000), type: 'DM' },
  ].filter((r) => r.sendAt > now);
  if (reminders.length > 0) await prisma.eventReminder.createMany({ data: reminders });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveForumChannelId(discordGuildId: string): Promise<string | null> {
  const guild = await prisma.guild
    .findUnique({ where: { guildId: discordGuildId }, include: { settings: true } })
    .catch(() => null);
  return guild?.settings?.forumChannelId ?? process.env['FORUM_CHANNEL_ID'] ?? null;
}

export async function resolveVcCategoryId(discordGuildId: string): Promise<string | null> {
  const guild = await prisma.guild
    .findUnique({ where: { guildId: discordGuildId }, include: { settings: true } })
    .catch(() => null);
  return guild?.settings?.voiceCategoryId ?? process.env['VC_CATEGORY_ID'] ?? null;
}

async function fetchImageAttachment(imageUrl: string): Promise<{ builder: AttachmentBuilder; filename: string } | null> {
  try {
    const apiBase = process.env['API_URL'] ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}${imageUrl}`);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = imageUrl.split('/').pop() ?? 'image.jpg';
    return { builder: new AttachmentBuilder(buffer, { name: filename }), filename };
  } catch {
    return null;
  }
}

async function fetchImageAsDataUri(imageUrl: string): Promise<string | undefined> {
  try {
    const apiBase = process.env['API_URL'] ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}${imageUrl}`);
    if (!res.ok) return undefined;
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    const b64 = Buffer.from(buffer).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch {
    return undefined;
  }
}
