import {
  AttachmentBuilder,
  ChannelType,
  DiscordAPIError,
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function buildGuildTagMap(roles: EventRole[]): Promise<Record<string, string>> {
  const guildIds = [...new Set(roles.filter((r) => r.guildId).map((r) => r.guildId as string))];
  if (guildIds.length === 0) return {};
  const rows = await prisma.$queryRaw<{ guildId: string; allianceTag: string | null }[]>`
    SELECT g."guildId", gs."allianceTag"
    FROM "Guild" g
    LEFT JOIN "GuildSettings" gs ON gs."guildId" = g.id
    WHERE g."guildId" = ANY(${guildIds})
  `;
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.allianceTag) map[row.guildId] = row.allianceTag;
  }
  return map;
}

function buildScheduledEventDescription(description: string | null, guildId: string, threadId: string | null): string | undefined {
  const link = threadId ? `https://discord.com/channels/${guildId}/${threadId}` : null;
  const suffix = link ? `\n\n📋 Discussion: ${link}` : '';
  let desc = description;
  if (desc && desc.length + suffix.length > 1000) desc = desc.slice(0, 999 - suffix.length) + '…';
  if (desc) return `${desc}${suffix}`;
  if (link) return `📋 Discussion: ${link}`;
  return undefined;
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
  const guildTagMap = await buildGuildTagMap(roles);
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
          const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename, guildTagMap);
          const components = buildRoleButtons(event.id, roles, event.rsvps, event.guildId);
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
          const pollDataRaw = event.pollData;
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
    data: { discordEventId, threadId, rosterMessageId },
  });

  // ── Post Discord event link to configured text channel (host guild) ───────
  if (!event.discordEventId && discordEventId) {
    await postEventLink(event.guildId, discordEventId).catch((err) =>
      console.error('[bot] postEventLink failed for host guild:', err),
    );
  }

  // ── Immediate VC creation (start < 30 min away) — host guild only ────────
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
      // Fetch with explicit error discrimination — we must NOT null out discordEventId
      // on transient errors (429, network blip) because that breaks GuildScheduledEventUserAdd
      // lookups for all subsequent "Interested" clicks. Only a genuine 404 (Unknown Guild
      // Scheduled Event, code 10070) means the event was actually deleted externally.
      let scheduled: Awaited<ReturnType<typeof guild.scheduledEvents.fetch>> | null = null;
      let genuinelyDeleted = false;
      try {
        scheduled = await guild.scheduledEvents.fetch(event.discordEventId);
      } catch (fetchErr) {
        // Discord API error code 10070 = Unknown Guild Scheduled Event (genuine 404)
        if (fetchErr instanceof DiscordAPIError && fetchErr.code === 10070) {
          genuinelyDeleted = true;
          console.warn(`[syncDiscordEvent] scheduled event ${event.discordEventId} confirmed deleted (10070) — clearing stored id for recreation`);
        } else {
          // Transient error (rate limit, network, permissions) — log and skip the update.
          // Do NOT clear discordEventId; that would break GuildScheduledEventUserAdd lookups.
          console.error(`[syncDiscordEvent] transient error fetching scheduled event ${event.discordEventId}:`, fetchErr);
        }
      }

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
        // Discord rejects scheduledStartTime edits on already-active events.
        // Only include time fields when the event hasn't started yet.
        const timeFields = event.startTime > new Date()
          ? { scheduledStartTime: event.startTime, scheduledEndTime }
          : {};
        await scheduled.edit({
          name: event.name,
          description: buildScheduledEventDescription(event.description, event.guildId, event.threadId),
          entityMetadata: { location: event.musterPoint ?? event.name },
          ...timeFields,
          ...imageField,
        });
        console.log(`[syncDiscordEvent] Discord scheduled event updated`);
      } else if (genuinelyDeleted) {
        // Confirmed deleted — null out so checkPendingDiscordSetup can recreate it.
        await prisma.event.update({ where: { id: event.id }, data: { discordEventId: null } });
      }
    } catch (err) {
      console.error('[bot] Failed to update Discord scheduled event:', err);
    }
  } else {
    console.log(`[syncDiscordEvent] skipping scheduled event update — discordEventId=${event.discordEventId ?? 'null'} status=${event.status}`);
  }

  // ── Update forum thread name + roster embed ───────────────────────────────
  const roles = JSON.parse(event.roles) as EventRole[];
  const guildTagMap = await buildGuildTagMap(roles);
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

        console.log(`[syncDiscordEvent] fetching image attachment — imageUrl=${event.imageUrl ?? 'null'}`);
        const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
        console.log(`[syncDiscordEvent] imageAttachment=${imageAttachment ? `ok (${imageAttachment.filename})` : 'null'}`);
        const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename, guildTagMap);
        const components = buildRoleButtons(event.id, roles, event.rsvps, event.guildId);

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

  // ── Sync existing alliance guild threads + scheduled events ───────────────
  const allianceGuilds = await prisma.eventAllianceGuild.findMany({ where: { eventId } });
  if (allianceGuilds.length === 0) return;

  const imageAttachmentSync = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
  const imageDataUriSync = event.imageUrl ? await fetchImageAsDataUri(event.imageUrl) : undefined;
  const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);

  // Process alliance guilds sequentially with a 1 s gap to avoid Discord rate limits
  for (const ag of allianceGuilds) {
    await sleep(1000);
    try {
      // Update scheduled event
      if (ag.discordEventId && event.status !== 'COMPLETED') {
        const memberGuild = await client.guilds.fetch(ag.discordGuildId).catch(() => null);
        const scheduled = await memberGuild?.scheduledEvents.fetch(ag.discordEventId).catch(() => null);
        if (scheduled) {
          const timeFields = event.startTime > new Date()
            ? { scheduledStartTime: event.startTime, scheduledEndTime }
            : {};
          await scheduled.edit({
            name: event.name,
            description: buildScheduledEventDescription(event.description, ag.discordGuildId, ag.threadId),
            entityMetadata: { location: event.musterPoint ?? event.name },
            ...timeFields,
            ...(imageDataUriSync ? { image: imageDataUriSync } : { image: null }),
          }).catch((err: unknown) => console.error(`[bot] Failed to update alliance scheduled event in ${ag.discordGuildId}:`, err));
        }
      }

      // Update thread name + roster embed
      if (ag.threadId) {
        const thread = await client.channels.fetch(ag.threadId).catch(() => null);
        if (!thread?.isThread()) continue;
        if (thread.name !== event.name) {
          await thread.setName(event.name).catch(() => null);
        }
        const embed = buildRosterEmbed(event, undefined, imageAttachmentSync?.filename, guildTagMap);
        const components = buildRoleButtons(event.id, roles, event.rsvps, ag.discordGuildId);
        const rosterMsg = ag.rosterMessageId
          ? await thread.messages.fetch(ag.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);
        if (rosterMsg) {
          const files = imageAttachmentSync ? [imageAttachmentSync.builder] : [];
          await rosterMsg.edit({ embeds: [embed], components, files }).catch(() => null);
        }
      }
    } catch (err) {
      console.error(`[syncDiscordEvent] alliance guild ${ag.discordGuildId} failed:`, err);
    }
  }
}

// ── Update the roster embed after any RSVP change ─────────────────────────────

export async function updateRosterEmbed(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { rsvps: true },
  });
  if (!event) return;

  const roles = JSON.parse(event.roles) as EventRole[];
  const guildTagMap = await buildGuildTagMap(roles);
  const eventImageUrl = event.imageUrl;
  const imageAttachment = eventImageUrl ? await fetchImageAttachment(eventImageUrl) : null;
  const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename, guildTagMap);

  type Components = ReturnType<typeof buildRoleButtons>;
  async function applyEdit(msg: Message, components: Components) {
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

  // Update host guild thread
  if (event.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        let rosterMsg: Message | null = null;
        if (event.rosterMessageId) {
          rosterMsg = await thread.messages.fetch(event.rosterMessageId).catch(() => null);
        }
        if (!rosterMsg) rosterMsg = await thread.fetchStarterMessage().catch(() => null);
        if (rosterMsg) await applyEdit(rosterMsg, buildRoleButtons(event.id, roles, undefined, event.guildId));
      }
    } catch (err) {
      console.error('[bot] Failed to update roster embed:', err);
    }
  }

  // Update alliance guild threads — sequential with a 1 s gap to avoid Discord rate limits
  const allianceGuilds = await prisma.eventAllianceGuild.findMany({ where: { eventId } });
  for (const ag of allianceGuilds.filter((ag) => ag.threadId)) {
    await sleep(1000);
    try {
      const thread = await client.channels.fetch(ag.threadId!).catch(() => null);
      if (!thread?.isThread()) continue;
      const msg = ag.rosterMessageId
        ? await thread.messages.fetch(ag.rosterMessageId).catch(() => null)
        : await thread.fetchStarterMessage().catch(() => null);
      if (msg) await applyEdit(msg, buildRoleButtons(event.id, roles, undefined, ag.discordGuildId));
    } catch (err) {
      console.error(`[updateRosterEmbed] alliance guild ${ag.discordGuildId} failed:`, err);
    }
  }
}

// ── Post "event is live" announcement at start time ──────────────────────────

export async function postEventLive(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.livePosted) return;

  // Mark first to prevent duplicate sends if the cron fires again before the send completes
  await prisma.event.update({ where: { id: eventId }, data: { livePosted: true } });

  const vcIds = JSON.parse(event.vcIds) as string[];
  const vcMentions = vcIds.map((id) => `<#${id}>`).join(' ');

  let content = `🟢 **${event.name}** is now live!`;
  if (vcMentions) content += `\nJoin a voice channel: ${vcMentions}`;
  if (event.musterPoint) content += `\n📍 ${event.musterPoint}`;

  if (event.threadId) {
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

  // Also broadcast to alliance guild threads (without VC mentions — VCs are host-only)
  const allianceContent = vcMentions
    ? content.replace(`\nJoin a voice channel: ${vcMentions}`, '')
    : content;
  const allianceGuilds = await prisma.eventAllianceGuild.findMany({ where: { eventId } });
  const filteredLiveGuilds = allianceGuilds.filter((ag) => ag.threadId);
  const liveResults = await Promise.allSettled(
    filteredLiveGuilds.map(async (ag) => {
      const thread = await client.channels.fetch(ag.threadId!).catch(() => null);
      if (!thread?.isThread()) return;
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send(allianceContent).catch(() => null);
    }),
  );
  for (let i = 0; i < liveResults.length; i++) {
    const r = liveResults[i];
    if (r?.status === 'rejected') {
      console.error(`[postEventLive] alliance guild ${filteredLiveGuilds[i]?.discordGuildId} failed:`, r.reason);
    }
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
  await Promise.allSettled(
    vcIds.map(async (vcId) => {
      const vc = client.channels.cache.get(vcId);
      if (!vc) return; // already gone — skip
      if (vc.type === ChannelType.GuildVoice && vc.members.size > 0) {
        keepIds.push(vcId); // still occupied — wait for last person to leave
        return;
      }
      await vc.delete().catch((err: unknown) => {
        console.error(`[bot] Could not delete VC ${vcId}:`, err instanceof Error ? err.message : err);
        keepIds.push(vcId);
      });
    }),
  );

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

  for (const vcId of vcIds) {
    const vc = client.channels.cache.get(vcId);
    if (vc?.type === ChannelType.GuildVoice) {
      vc.members.forEach((m) => activeUserIds.add(m.id));
    }
  }

  // Delete the Discord Scheduled Event (host guild)
  if (event.discordEventId) {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      await guild.scheduledEvents.delete(event.discordEventId).catch(() => null);
    } catch (err) {
      console.error('[bot] Failed to delete Discord scheduled event:', err);
    }
  }

  // Update embed with VC attendance + remove buttons, then archive host thread
  const endRoles = JSON.parse(event.roles) as EventRole[];
  const guildTagMap = await buildGuildTagMap(endRoles);
  const imageAttachment = event.imageUrl ? await fetchImageAttachment(event.imageUrl) : null;
  if (event.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        const rosterMsg = event.rosterMessageId
          ? await thread.messages.fetch(event.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);
        if (rosterMsg) {
          const updatedEmbed = buildRosterEmbed(event, activeUserIds, imageAttachment?.filename, guildTagMap);
          const files = imageAttachment ? [imageAttachment.builder] : [];
          await rosterMsg.edit({ embeds: [updatedEmbed], components: [], files }).catch(() => null);
        }
        await thread.send(`🏁 **${event.name}** has ended.`);
      }
    } catch (err) {
      console.error('[bot] Failed to archive forum thread:', err);
    }
  }

  // End event in all alliance guild threads
  const allianceGuilds = await prisma.eventAllianceGuild.findMany({ where: { eventId } });
  const endResults = await Promise.allSettled(
    allianceGuilds.map(async (ag) => {
      if (ag.discordEventId) {
        const memberGuild = await client.guilds.fetch(ag.discordGuildId).catch(() => null);
        await memberGuild?.scheduledEvents.delete(ag.discordEventId).catch(() => null);
      }
      if (ag.threadId) {
        const thread = await client.channels.fetch(ag.threadId).catch(() => null);
        if (!thread?.isThread()) return;
        const rosterMsg = ag.rosterMessageId
          ? await thread.messages.fetch(ag.rosterMessageId).catch(() => null)
          : await thread.fetchStarterMessage().catch(() => null);
        if (rosterMsg) {
          const updatedEmbed = buildRosterEmbed(event, activeUserIds, imageAttachment?.filename, guildTagMap);
          const files = imageAttachment ? [imageAttachment.builder] : [];
          await rosterMsg.edit({ embeds: [updatedEmbed], components: [], files }).catch(() => null);
        }
        await thread.send(`🏁 **${event.name}** has ended.`).catch(() => null);
      }
    }),
  );
  for (let i = 0; i < endResults.length; i++) {
    const r = endResults[i];
    if (r?.status === 'rejected') {
      console.error(`[endEvent] alliance guild ${allianceGuilds[i]?.discordGuildId} failed:`, r.reason);
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

  // Stop the chain if the next occurrence would fall after the configured end date.
  if (event.recurEndsAt && nextStart > event.recurEndsAt) {
    console.log(`[bot] spawnNextRecurrence: recurrence chain for ${event.id} ends — nextStart ${nextStart.toISOString()} is past recurEndsAt ${event.recurEndsAt.toISOString()}`);
    return;
  }
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
      pollData: event.pollData ?? null,
      allianceId: event.allianceId ?? null,
      recurEndsAt: event.recurEndsAt ?? null,
      createdById: event.createdById,
      status: 'PENDING',
    },
  });

  // Re-invite guilds that accepted the previous occurrence.
  // Only ACCEPTED shares propagate — PENDING means they never responded to the
  // last invite (don't auto-forward), DECLINED means they explicitly opted out.
  // New invites are created as PENDING so each guild gets the standard accept/decline
  // flow for each occurrence rather than being silently added.
  const acceptedShares = await prisma.eventGuildShare.findMany({
    where: { eventId, status: 'ACCEPTED' },
    select: { guildId: true, sourceType: true, allianceId: true },
  });
  if (acceptedShares.length > 0) {
    await prisma.eventGuildShare.createMany({
      data: acceptedShares.map((s) => ({
        eventId: next.id,
        guildId: s.guildId,
        sourceType: s.sourceType,
        allianceId: s.allianceId,
        status: 'PENDING' as const,
      })),
      skipDuplicates: true,
    });
    console.log(`[bot] spawnNextRecurrence: re-invited ${acceptedShares.length} guild(s) for event ${next.id}`);
  }

  // Build reminder schedule.
  // If the event has a linked template with a custom reminderMinutes array, use that
  // for FORUM reminders. Otherwise fall back to the hardcoded 60 min + 30 min defaults.
  // The 15-min DM reminder is always added regardless — it's the most actionable one.
  let forumReminderMinutes: number[] = [60, 30];
  const template = await prisma.eventTemplate
    .findUnique({ where: { sourceEventId: event.id }, select: { reminderMinutes: true } })
    .catch(() => null);
  if (template) {
    const parsed = JSON.parse(template.reminderMinutes) as number[];
    if (parsed.length > 0) forumReminderMinutes = parsed;
  }

  const reminders = [
    ...forumReminderMinutes.map((m) => ({
      eventId: next.id,
      sendAt: new Date(nextStart.getTime() - m * 60_000),
      type: 'FORUM',
    })),
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

async function postEventLink(discordGuildId: string, scheduledEventId: string): Promise<void> {
  const guildRecord = await prisma.guild
    .findUnique({ where: { guildId: discordGuildId }, include: { settings: true } })
    .catch(() => null);
  const channelId = guildRecord?.settings?.eventChannelId ?? null;
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased() && ch.isSendable()) {
      await ch.send(`https://discord.com/events/${discordGuildId}/${scheduledEventId}`);
    }
  } catch (err) {
    console.error(`[bot] Failed to post event link to channel ${channelId}:`, err);
  }
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

// ── Revoke an accepted share: clean up Discord artifacts in the receiving guild ─

export async function revokeDiscordShare(shareId: string): Promise<void> {
  console.log(`[revokeDiscordShare] start — shareId=${shareId}`);

  const share = await prisma.eventGuildShare.findUnique({
    where: { id: shareId },
    include: { guild: true },
  });

  if (!share) {
    console.error(`[revokeDiscordShare] share ${shareId} not found`);
    return;
  }

  const receivingDiscordGuildId = share.guild.guildId;

  const ag = await prisma.eventAllianceGuild.findUnique({
    where: { eventId_discordGuildId: { eventId: share.eventId, discordGuildId: receivingDiscordGuildId } },
  });

  if (!ag) {
    console.log(`[revokeDiscordShare] no EventAllianceGuild record found for ${receivingDiscordGuildId} — nothing to clean up`);
    return;
  }

  // Delete the Discord scheduled event in the receiving guild
  if (ag.discordEventId) {
    const memberGuild = await client.guilds.fetch(receivingDiscordGuildId).catch(() => null);
    if (memberGuild) {
      await memberGuild.scheduledEvents.delete(ag.discordEventId).catch((err: unknown) =>
        console.error(`[revokeDiscordShare] failed to delete scheduled event in ${receivingDiscordGuildId}:`, err),
      );
    }
  }

  // Post revocation notice in the thread and archive it
  if (ag.threadId) {
    const thread = await client.channels.fetch(ag.threadId).catch(() => null);
    if (thread?.isThread()) {
      if (thread.archived) await thread.setArchived(false).catch(() => null);
      await thread.send('❌ This event invitation has been revoked by the host guild.').catch(() => null);
      await thread.setArchived(true).catch(() => null);
    }
  }

  // Remove the EventAllianceGuild record so the receiving guild has no residual access
  await prisma.eventAllianceGuild.delete({ where: { id: ag.id } }).catch((err) =>
    console.error(`[revokeDiscordShare] failed to delete EventAllianceGuild for ${receivingDiscordGuildId}:`, err),
  );

  console.log(`[revokeDiscordShare] done — shareId=${shareId}, guild=${receivingDiscordGuildId}`);
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

// ── Set up Discord entities for a single accepted share ───────────────────────

const setupShareInFlight = new Set<string>();

export async function setupDiscordForShare(shareId: string): Promise<void> {
  if (setupShareInFlight.has(shareId)) {
    console.log(`[setupDiscordForShare] already in progress — skipping ${shareId}`);
    return;
  }
  setupShareInFlight.add(shareId);
  try {
    await _setupDiscordForShare(shareId);
  } finally {
    setupShareInFlight.delete(shareId);
  }
}

async function _setupDiscordForShare(shareId: string): Promise<void> {
  console.log(`[setupDiscordForShare] start — shareId=${shareId}`);

  const share = await prisma.eventGuildShare.findUnique({
    where: { id: shareId },
    include: {
      event: { include: { rsvps: { select: { userId: true, role: true } } } },
      guild: true,
    },
  });

  if (!share) {
    console.error(`[setupDiscordForShare] share ${shareId} not found`);
    return;
  }
  if (share.status !== 'ACCEPTED') {
    console.warn(`[setupDiscordForShare] share ${shareId} is not ACCEPTED (status=${share.status})`);
    return;
  }

  const { event, guild } = share;
  const receivingDiscordGuildId = guild.guildId;

  const existing = await prisma.eventAllianceGuild.findUnique({
    where: { eventId_discordGuildId: { eventId: event.id, discordGuildId: receivingDiscordGuildId } },
    include: { share: { select: { status: true } } },
  });
  if (existing) {
    // Detect stale orphan: the linked share was DECLINED (host revoked), but revokeDiscordShare
    // crashed before it could delete this row. Treat it as replaceable — delete it and fall through
    // so fresh Discord entities get created for the new acceptance.
    if (existing.shareId && existing.share?.status === 'DECLINED') {
      console.log(`[setupDiscordForShare] stale EventAllianceGuild found for guild ${receivingDiscordGuildId} (linked share DECLINED) — removing and re-creating`);
      await prisma.eventAllianceGuild.delete({ where: { id: existing.id } }).catch(() => null);
      // Fall through to the setup logic below
    } else {
      // Legitimately set up. Backfill shareId on legacy rows that predate the shareId field
      // so they stop appearing as orphaned in the scheduler backstop (checkPendingShareSetup).
      if (!existing.shareId) {
        await prisma.eventAllianceGuild.update({
          where: { id: existing.id },
          data: { shareId },
        }).catch(() => null); // concurrent update from another tick is fine — same value
      }
      console.log(`[setupDiscordForShare] already set up for guild ${receivingDiscordGuildId}, skipping`);
      return;
    }
  }

  const roles = JSON.parse(event.roles) as EventRole[];
  const guildTagMap = await buildGuildTagMap(roles);

  const [imageAttachment, imageDataUri] = await Promise.all([
    event.imageUrl ? fetchImageAttachment(event.imageUrl) : Promise.resolve(null),
    event.imageUrl ? fetchImageAsDataUri(event.imageUrl) : Promise.resolve(undefined),
  ]);
  const scheduledEndTime = event.endTime ?? new Date(event.startTime.getTime() + 2 * 60 * 60_000);

  let threadId: string | null = null;
  let rosterMessageId: string | null = null;
  let discordEventId: string | null = null;

  const discordGuild = await client.guilds.fetch(receivingDiscordGuildId);

  const forumChannelId = await resolveForumChannelId(receivingDiscordGuildId);
  if (forumChannelId) {
    const ch = await client.channels.fetch(forumChannelId).catch(() => null);
    if (ch?.type === ChannelType.GuildForum) {
      const embed = buildRosterEmbed(event, undefined, imageAttachment?.filename, guildTagMap);
      const components = buildRoleButtons(event.id, roles, [], receivingDiscordGuildId);
      const thread = await (ch as ForumChannel).threads.create({
        name: event.name,
        message: {
          embeds: [embed],
          components,
          files: imageAttachment ? [imageAttachment.builder] : [],
        },
      });
      threadId = thread.id;
      const starter = await thread.fetchStarterMessage().catch(() => null);
      rosterMessageId = starter?.id ?? null;
      console.log(`[setupDiscordForShare] thread created in ${receivingDiscordGuildId} — ${threadId}`);
    }
  }

  if (event.startTime > new Date()) {
    const scheduled = await discordGuild.scheduledEvents.create({
      name: event.name,
      description: buildScheduledEventDescription(event.description, receivingDiscordGuildId, threadId),
      scheduledStartTime: event.startTime,
      scheduledEndTime,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: event.musterPoint ?? event.name },
      ...(imageDataUri ? { image: imageDataUri } : {}),
    }).catch((err) => {
      console.error(`[setupDiscordForShare] failed to create scheduled event in ${receivingDiscordGuildId}:`, err);
      return null;
    });
    discordEventId = scheduled?.id ?? null;
    if (discordEventId) {
      await postEventLink(receivingDiscordGuildId, discordEventId).catch((err) =>
        console.error(`[bot] postEventLink failed for shared guild ${receivingDiscordGuildId}:`, err),
      );
    }
  }

  await prisma.eventAllianceGuild.create({
    data: {
      eventId: event.id,
      discordGuildId: receivingDiscordGuildId,
      threadId,
      rosterMessageId,
      discordEventId,
      shareId, // links this record back to the EventGuildShare that triggered setup
    },
  });

  console.log(`[setupDiscordForShare] done — shareId=${shareId}, guild=${receivingDiscordGuildId}`);
}
