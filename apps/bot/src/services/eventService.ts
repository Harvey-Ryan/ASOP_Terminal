import {
  AttachmentBuilder,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
} from 'discord.js';
import type { ForumChannel, Message } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { buildRosterEmbed, buildRoleButtons, buildPostEventEmbed } from '../utils/embeds.js';
import { nextOccurrence } from '../utils/time.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';
import type { EventPoll, EventRole } from '@dem/shared';

// ── Create VCs for an event (idempotent — skips if already created) ──────────

export async function createVcsForEvent(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;

  const vcNames = JSON.parse(event.vcNames) as string[];
  const existingIds: string[] = JSON.parse(event.vcIds);
  if (existingIds.length > 0) return;
  if (vcNames.length === 0 && !event.briefingChannel) return;

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

    if (event.briefingChannel) {
      const briefing = await guild.channels.create({
        name: '📋 Briefing',
        type: ChannelType.GuildVoice,
        ...(categoryId ? { parent: categoryId } : {}),
        permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.UseVAD] }],
      });
      createdIds.push(briefing.id);
    }

    await prisma.event.update({
      where: { id: event.id },
      data: { vcIds: JSON.stringify(createdIds), lastVcActivityAt: new Date() },
    });

    if (event.threadId && createdIds.length > 0) {
      const thread = await client.channels.fetch(event.threadId).catch(() => null);
      if (thread?.isThread()) {
        const mentions = createdIds.map((id) => `<#${id}>`).join(', ');
        const ts = Math.floor(event.startTime.getTime() / 1000);
        await thread.send(
          `🎙️ Voice channels ready for **${event.name}**! Join: ${mentions} — event starts <t:${ts}:R>`,
        );
      }
    }
  } catch (err) {
    console.error(`[bot] Failed to create VCs for event ${eventId}:`, err);
  }
}

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
          const components = buildRoleButtons(event.id, roles, event.rsvps);
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

          // Post poll below the embed if one was configured
          const pollDataRaw = (event as unknown as { pollData?: string | null }).pollData;
          if (pollDataRaw) {
            try {
              const poll = JSON.parse(pollDataRaw) as EventPoll;
              await thread.send({
                poll: {
                  question: { text: poll.question },
                  answers: poll.options.map((opt: string) => ({ text: opt })),
                  duration: poll.duration,
                  allowMultiselect: poll.allowMultiselect,
                },
              });
            } catch (pollErr) {
              console.error('[bot] Failed to post poll to thread:', pollErr);
            }
          }
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

  await prisma.event.update({
    where: { id: event.id },
    data: { discordEventId, threadId, rosterMessageId, status: 'ACTIVE' },
  });

  // ── Immediate VC creation (start < 30 min away) ──────────────────────────
  if (event.startTime.getTime() - Date.now() < 30 * 60_000) {
    await createVcsForEvent(eventId);
  }
}

// ── Sync Discord entities after an event edit ────────────────────────────────

export async function syncDiscordEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event) return;

  // ── Update Discord Scheduled Event ───────────────────────────────────────
  if (event.discordEventId && event.status !== 'COMPLETED') {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const scheduled = await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null);
      if (scheduled) {
        const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);
        let imageField: { image: string | null } | Record<string, never> = {};
        if (event.imageUrl) {
          const uri = await fetchImageAsDataUri(event.imageUrl);
          if (uri) imageField = { image: uri };
        } else {
          imageField = { image: null };
        }
        await scheduled.edit({
          name: event.name,
          description: event.description ?? undefined,
          scheduledStartTime: event.startTime,
          scheduledEndTime,
          entityMetadata: { location: event.musterPoint ?? event.name },
          ...imageField,
        });
      }
    } catch (err) {
      console.error('[bot] Failed to update Discord scheduled event:', err);
    }
  }

  // ── Update forum thread name + roster embed ───────────────────────────────
  if (event.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        if (thread.name !== event.name) {
          await thread.setName(event.name).catch((err) =>
            console.error('[bot] Failed to rename forum thread:', err),
          );
        }

        const roles = JSON.parse(event.roles) as EventRole[];
        const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
        const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename);
        const components = buildRoleButtons(event.id, roles, event.rsvps);

        const rosterMsg = event.rosterMessageId
          ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);

        if (rosterMsg) {
          let files: AttachmentBuilder[] = [];
          let keepAttachments: { id: string }[] = [];
          if (imageAttachment) {
            files = [imageAttachment.builder];
          } else if (event.imageUrl) {
            // Fetch failed — preserve existing Discord attachment so image doesn't vanish
            keepAttachments = [...rosterMsg.attachments.values()].map((a) => ({ id: a.id }));
            const existingImageUrl = rosterMsg.embeds[0]?.image?.url;
            if (existingImageUrl) embed.setImage(existingImageUrl);
          }
          await rosterMsg.edit({ embeds: [embed], components, files, attachments: keepAttachments });
        }
      }
    } catch (err) {
      console.error('[bot] Failed to sync forum thread after edit:', err);
    }
  }
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

  async function applyEdit(msg: Message) {
    let files: AttachmentBuilder[] = [];
    let keepAttachments: { id: string }[] = [];
    if (imageAttachment) {
      files = [imageAttachment.builder];
    } else if (event.imageUrl) {
      keepAttachments = [...msg.attachments.values()].map((a) => ({ id: a.id }));
      const existingImageUrl = msg.embeds[0]?.image?.url;
      if (existingImageUrl) embed.setImage(existingImageUrl);
    }
    await msg.edit({ embeds: [embed], components, files, attachments: keepAttachments });
  }

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (!thread?.isThread()) return;

    if (event.rosterMessageId) {
      const msg = await thread.messages.fetch(event.rosterMessageId).catch(() => null);
      if (msg) { await applyEdit(msg); return; }
    }

    // Fallback: edit starter message
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await applyEdit(starter);
  } catch (err) {
    console.error('[bot] Failed to update roster embed:', err);
  }
}

// ── Post "event is live" announcement at start time ──────────────────────────

export async function postEventLive(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event?.threadId || event.livePosted) return;

  // Mark first to prevent duplicate sends if the cron fires again before the send completes
  await prisma.event.update({ where: { id: eventId }, data: { livePosted: true } });

  const vcIds = JSON.parse(event.vcIds) as string[];
  const vcMentions = vcIds.map((id) => `<#${id}>`).join(' ');

  let content = `🟢 **${event.name}** is now live!`;
  if (vcMentions) content += `\nJoin a voice channel: ${vcMentions}`;
  if (event.musterPoint) content += `\n📍 ${event.musterPoint}`;

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send(content);
    }
  } catch (err) {
    console.error(`[bot] Failed to post live message for event ${eventId}:`, err);
  }
}

// ── End event (called by scheduler after status=ENDED is detected) ────────────

// ── Delete VCs for an ended event, skipping any that still have members ────────
// Called by endEvent and by VoiceStateUpdate when the last person leaves.

export async function deleteEventVcs(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.botCleanedUp) return;

  const vcIds = JSON.parse(event.vcIds) as string[];
  if (vcIds.length === 0) {
    await prisma.event.update({ where: { id: eventId }, data: { botCleanedUp: true } });
    return;
  }

  const keepIds: string[] = [];
  try {
    const guild = await client.guilds.fetch(event.guildId);
    for (const vcId of vcIds) {
      const vc = await guild.channels.fetch(vcId).catch(() => null);
      if (!vc) continue; // already gone — skip
      if (vc.type === ChannelType.GuildVoice && vc.members.size > 0) {
        keepIds.push(vcId); // still occupied — wait for last person to leave
        continue;
      }
      await vc.delete().catch((err: unknown) => {
        console.error(`[bot] Could not delete VC ${vcId}:`, err instanceof Error ? err.message : err);
        keepIds.push(vcId);
      });
    }
  } catch (err) {
    console.error('[bot] deleteEventVcs: guild fetch failed:', err);
    return; // don't update DB — retry on next voiceStateUpdate
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { vcIds: JSON.stringify(keepIds), botCleanedUp: keepIds.length === 0 },
  });
}

export async function endEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { rsvps: true },
  });

  // Collect who was in VCs at the moment the event ended (for vcAttendees record)
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
      }
    } catch (err) {
      console.error('[bot] endEvent: failed to read VC members:', err);
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
    data: { vcAttendees: JSON.stringify([...activeUserIds]) },
  });

  // Delete VCs now — occupied ones are skipped and cleaned up via VoiceStateUpdate
  await deleteEventVcs(eventId);

  if (event.recurType) {
    await spawnNextRecurrence(event.id).catch((err) =>
      console.error(`[bot] spawnNextRecurrence failed for ${event.id}:`, err),
    );
    await prisma.event.update({ where: { id: event.id }, data: { recurType: null } });
  }
}

// ── Post-event embed (confirmed attendees + loot) ────────────────────────────

export async function updatePostEventEmbed(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event?.threadId || !event.confirmedAttendees) return;

  const confirmedIds: string[] = JSON.parse(event.confirmedAttendees);
  if (confirmedIds.length === 0) return;

  // Build a userId → items-won map from the loot session (if one exists)
  const lootByUser = new Map<string, { name: string; quantity: number }[]>();
  const session = await prisma.lootSession.findUnique({
    where: { eventId },
    include: { items: { include: { assignments: true } } },
  });
  if (session) {
    for (const item of session.items) {
      for (const a of item.assignments) {
        const wins = lootByUser.get(a.userId) ?? [];
        wins.push({ name: item.name, quantity: item.quantity });
        lootByUser.set(a.userId, wins);
      }
    }
  }

  const attendees = confirmedIds.map((userId) => ({
    userId,
    items: lootByUser.get(userId) ?? [],
  }));

  const dkpAward = session?.dkpAward && session.dkpAward > 0 ? session.dkpAward : undefined;
  const dkpLabel = dkpAward ? await getGuildDkpLabel(event.guildId) : undefined;

  const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
  const embed = buildPostEventEmbed(event, attendees, imageAttachment?.filename, dkpAward, dkpLabel);
  const files = imageAttachment ? [imageAttachment.builder] : [];

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (!thread?.isThread()) return;

    const wasArchived = thread.archived ?? false;
    if (wasArchived) await thread.setArchived(false).catch(() => null);

    const rosterMsg = event.rosterMessageId
      ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
      : await thread.fetchStarterMessage().catch(() => null);

    if (rosterMsg) {
      await rosterMsg.edit({ embeds: [embed], components: [], files });
    }

    if (wasArchived) await thread.setArchived(true).catch(() => null);
  } catch (err) {
    console.error('[bot] Failed to update post-event embed:', err);
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
      briefingChannel: event.briefingChannel,
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
  const apiBase = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
  const fullUrl = `${apiBase}${imageUrl}`;
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      console.error(`[fetchImageAttachment] HTTP ${res.status} fetching ${fullUrl}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = imageUrl.split('/').pop() ?? 'image.jpg';
    return { builder: new AttachmentBuilder(buffer, { name: filename }), filename };
  } catch (err) {
    console.error(`[fetchImageAttachment] Failed to fetch ${fullUrl}:`, err);
    return null;
  }
}

async function fetchImageAsDataUri(imageUrl: string): Promise<string | undefined> {
  const apiBase = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
  const fullUrl = `${apiBase}${imageUrl}`;
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      console.error(`[fetchImageAsDataUri] HTTP ${res.status} fetching ${fullUrl}`);
      return undefined;
    }
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    const b64 = Buffer.from(buffer).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    console.error(`[fetchImageAsDataUri] Failed to fetch ${fullUrl}:`, err);
    return undefined;
  }
}
