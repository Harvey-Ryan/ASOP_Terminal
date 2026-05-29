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

function buildScheduledEventDescription(description: string | null, guildId: string, threadId: string | null): string | undefined {
  const link = threadId ? `https://discord.com/channels/${guildId}/${threadId}` : null;
  if (description && link) return `${description}\n\n📋 Discussion: ${link}`;
  if (link) return `📋 Discussion: ${link}`;
  return description ?? undefined;
}

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

const setupInFlight = new Set<string>();

export async function setupDiscordForEvent(eventId: string) {
  if (setupInFlight.has(eventId)) {
    console.log(`[setupDiscordForEvent] already in progress — skipping ${eventId}`);
    return;
  }
  setupInFlight.add(eventId);
  try {
    await _setupDiscordForEvent(eventId);
  } finally {
    setupInFlight.delete(eventId);
  }
}

async function _setupDiscordForEvent(eventId: string) {
  console.log(`[setupDiscordForEvent] start — eventId=${eventId}`);
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { rsvps: true },
  });
  console.log(`[setupDiscordForEvent] event loaded — name="${event.name}" imageUrl=${event.imageUrl ?? 'null'} threadId=${event.threadId ?? 'null'} discordEventId=${event.discordEventId ?? 'null'}`);

  const guild = await client.guilds.fetch(event.guildId);
  const roles = JSON.parse(event.roles) as EventRole[];
  let { discordEventId, threadId, rosterMessageId } = event;

  // ── Forum thread ──────────────────────────────────────────────────────────

  if (!threadId) {
    const forumChannelId = await resolveForumChannelId(event.guildId);
    console.log(`[setupDiscordForEvent] forumChannelId=${forumChannelId ?? 'null'}`);
    if (forumChannelId) {
      try {
        const ch = await client.channels.fetch(forumChannelId);
        if (ch?.type === ChannelType.GuildForum) {
          console.log(`[setupDiscordForEvent] fetching image attachment — imageUrl=${event.imageUrl ?? 'null'}`);
          const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
          console.log(`[setupDiscordForEvent] imageAttachment=${imageAttachment ? `ok (${imageAttachment.filename})` : 'null'}`);
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
    console.log(`[setupDiscordForEvent] creating Discord scheduled event — imageUrl=${event.imageUrl ?? 'null'}`);
    try {
      let imageDataUri: string | undefined;
      if (event.imageUrl) {
        imageDataUri = await fetchImageAsDataUri(event.imageUrl);
        console.log(`[setupDiscordForEvent] imageDataUri for scheduled event: ${imageDataUri ? `ok (${imageDataUri.length} chars)` : 'undefined'}`);
      }

      // External events require an end time — default to start + 2 hours
      const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);

      const scheduled = await guild.scheduledEvents.create({
        name: event.name,
        description: buildScheduledEventDescription(event.description, event.guildId, threadId),
        scheduledStartTime: event.startTime,
        scheduledEndTime,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: event.musterPoint ?? event.name },
        ...(imageDataUri ? { image: imageDataUri } : {}),
      });
      discordEventId = scheduled.id;
      console.log(`[setupDiscordForEvent] Discord scheduled event created — id=${discordEventId}`);
      // Persist immediately — GuildScheduledEventUserAdd can fire within milliseconds
      await prisma.event.update({ where: { id: event.id }, data: { discordEventId } });
    } catch (err) {
      console.error('[bot] Failed to create Discord scheduled event:', err);
    }
  } else {
    console.log(`[setupDiscordForEvent] skipping scheduled event creation — discordEventId=${discordEventId ?? 'null'} startTime=${event.startTime.toISOString()} now=${new Date().toISOString()}`);
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
  console.log(`[syncDiscordEvent] start — eventId=${eventId}`);
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event) { console.warn(`[syncDiscordEvent] event not found — ${eventId}`); return; }
  console.log(`[syncDiscordEvent] event loaded — name="${event.name}" imageUrl=${event.imageUrl ?? 'null'} discordEventId=${event.discordEventId ?? 'null'} threadId=${event.threadId ?? 'null'} status=${event.status}`);

  // ── Update Discord Scheduled Event ───────────────────────────────────────
  if (event.discordEventId && event.status !== 'COMPLETED') {
    console.log(`[syncDiscordEvent] updating Discord scheduled event ${event.discordEventId}`);
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const scheduled = await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null);
      if (scheduled) {
        const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);
        let imageField: { image: string | null } | Record<string, never> = {};
        if (event.imageUrl) {
          console.log(`[syncDiscordEvent] fetching data URI for scheduled event — imageUrl=${event.imageUrl}`);
          const uri = await fetchImageAsDataUri(event.imageUrl);
          console.log(`[syncDiscordEvent] data URI result: ${uri ? `ok (${uri.length} chars)` : 'undefined'}`);
          if (uri) imageField = { image: uri };
          else console.warn(`[syncDiscordEvent] data URI was undefined — scheduled event image will NOT be updated`);
        } else {
          imageField = { image: null };
          console.log(`[syncDiscordEvent] no imageUrl — clearing scheduled event image`);
        }
        await scheduled.edit({
          name: event.name,
          description: buildScheduledEventDescription(event.description, event.guildId, event.threadId),
          scheduledStartTime: event.startTime,
          scheduledEndTime,
          entityMetadata: { location: event.musterPoint ?? event.name },
          ...imageField,
        });
        console.log(`[syncDiscordEvent] Discord scheduled event updated`);
      } else {
        console.warn(`[syncDiscordEvent] scheduled event ${event.discordEventId} not found in guild`);
      }
    } catch (err) {
      console.error('[bot] Failed to update Discord scheduled event:', err);
    }
  } else {
    console.log(`[syncDiscordEvent] skipping scheduled event update — discordEventId=${event.discordEventId ?? 'null'} status=${event.status}`);
  }

  // ── Update forum thread name + roster embed ───────────────────────────────
  if (event.threadId) {
    console.log(`[syncDiscordEvent] updating forum thread ${event.threadId}`);
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        if (thread.name !== event.name) {
          await thread.setName(event.name).catch((err) =>
            console.error('[bot] Failed to rename forum thread:', err),
          );
        }

        const roles = JSON.parse(event.roles) as EventRole[];
        console.log(`[syncDiscordEvent] fetching image attachment — imageUrl=${event.imageUrl ?? 'null'}`);
        const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
        console.log(`[syncDiscordEvent] imageAttachment=${imageAttachment ? `ok (${imageAttachment.filename})` : 'null'}`);
        const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename);
        const components = buildRoleButtons(event.id, roles, event.rsvps);

        const rosterMsg = event.rosterMessageId
          ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);
        console.log(`[syncDiscordEvent] rosterMsg=${rosterMsg ? rosterMsg.id : 'null'} existingAttachments=${rosterMsg?.attachments.size ?? 0} existingEmbedImage=${rosterMsg?.embeds[0]?.image?.url ?? 'none'}`);

        if (rosterMsg) {
          let files: AttachmentBuilder[] = [];
          let keepAttachments: { id: string }[] = [];
          if (imageAttachment) {
            files = [imageAttachment.builder];
            console.log(`[syncDiscordEvent] uploading new image attachment: ${imageAttachment.filename}`);
          } else if (event.imageUrl) {
            // Fetch failed — preserve existing Discord attachment so image doesn't vanish
            keepAttachments = [...rosterMsg.attachments.values()].map((a) => ({ id: a.id }));
            const existingImageUrl = rosterMsg.embeds[0]?.image?.url;
            if (existingImageUrl) embed.setImage(existingImageUrl);
            console.log(`[syncDiscordEvent] fetch failed — preserving ${keepAttachments.length} existing attachment(s), existingImageUrl=${existingImageUrl ?? 'none'}`);
          } else {
            console.log(`[syncDiscordEvent] no imageUrl — clearing attachments`);
          }
          await rosterMsg.edit({ embeds: [embed], components, files, attachments: keepAttachments });
          console.log(`[syncDiscordEvent] roster embed updated`);
        } else {
          console.warn(`[syncDiscordEvent] roster message not found — cannot update embed`);
        }
      } else {
        console.warn(`[syncDiscordEvent] thread ${event.threadId} is not a thread channel`);
      }
    } catch (err) {
      console.error('[bot] Failed to sync forum thread after edit:', err);
    }
  } else {
    console.log(`[syncDiscordEvent] no threadId — skipping forum thread update`);
  }
  console.log(`[syncDiscordEvent] done — eventId=${eventId}`);
}

// ── Update the roster embed after any RSVP change ─────────────────────────────

export async function updateRosterEmbed(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event?.threadId) return;

  const roles = JSON.parse(event.roles) as EventRole[];
  const eventImageUrl = event.imageUrl;
  const imageAttachment = eventImageUrl ? await fetchImageAttachment(eventImageUrl) : null;
  const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename);
  const components = buildRoleButtons(event.id, roles);

  async function applyEdit(msg: Message) {
    let files: AttachmentBuilder[] = [];
    let keepAttachments: { id: string }[] = [];
    if (imageAttachment) {
      files = [imageAttachment.builder];
    } else if (eventImageUrl) {
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
  // Atomic claim: only the first caller runs the thread/embed work.
  // Subsequent calls (scheduler retries, concurrent triggers) exit immediately.
  const claim = await prisma.event.updateMany({
    where: { id: eventId, botEndedAt: null },
    data: { botEndedAt: new Date() },
  });
  if (claim.count === 0) return;

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
      }
    } catch (err) {
      console.error('[bot] Failed to archive forum thread:', err);
    }
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { vcAttendees: JSON.stringify([...activeUserIds]) },
  });

  // VC deletion is deferred — the scheduler deletes VCs once they have been
  // empty for 5 continuous minutes (tracked via vcsEmptiedAt in checkEndedEvents).

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
  if (!event?.threadId) return;

  const confirmedIds: string[] = event.confirmedAttendees
    ? JSON.parse(event.confirmedAttendees)
    : [];

  // Build the post-event embed only when there are confirmed attendees
  let embed: ReturnType<typeof buildPostEventEmbed> | null = null;
  let files: AttachmentBuilder[] = [];

  if (confirmedIds.length > 0) {
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
    embed = buildPostEventEmbed(event, attendees, imageAttachment?.filename, dkpAward, dkpLabel);
    files = imageAttachment ? [imageAttachment.builder] : [];
  }

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (!thread?.isThread()) return;

    const wasArchived = thread.archived ?? false;
    if (wasArchived) await thread.setArchived(false).catch(() => null);

    if (embed) {
      const rosterMsg = event.rosterMessageId
        ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
        : await thread.fetchStarterMessage().catch(() => null);

      if (rosterMsg) {
        await rosterMsg.edit({ embeds: [embed], components: [], files });
      }
    }

    // Archive when no loot — loot path archives in announceLootResults after posting results
    if (!event.hadLoot) {
      await thread.setArchived(true).catch(() => null);
    } else if (wasArchived) {
      await thread.setArchived(true).catch(() => null);
    }
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
