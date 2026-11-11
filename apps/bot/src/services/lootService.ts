import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
import { getGuildDkpLabel } from '../utils/dkpLabel.js';

const LOOT_PICKER_ROLE = 'Loot Picker';

async function buildDraftUserTagMap(eventId: string, draftOrder: string[]): Promise<Map<string, string>> {
  if (draftOrder.length === 0) return new Map();

  // Query 1+2: event guildId + alliance guild snowflakes in one fetch
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { guildId: true, allianceGuilds: { select: { discordGuildId: true } } },
  });
  if (!event) return new Map();

  const discordGuildIds = [event.guildId, ...event.allianceGuilds.map((r) => r.discordGuildId)];

  // Query 3: Guild DB rows with alliance tags
  const guilds = await prisma.guild.findMany({
    where: { guildId: { in: discordGuildIds } },
    select: { id: true, guildId: true, settings: { select: { allianceTag: true } } },
  });

  const guildDbIdToTag = new Map<string, string>();
  for (const g of guilds) {
    if (g.settings?.allianceTag) guildDbIdToTag.set(g.id, g.settings.allianceTag);
  }
  if (guildDbIdToTag.size === 0) return new Map();

  const taggedGuildIds = [...guildDbIdToTag.keys()];
  const hostGuildDbId = guilds.find((g) => g.guildId === event.guildId)?.id;

  // Query 4+5: users + their memberships in tagged guilds, joined
  const users = await prisma.user.findMany({
    where: { discordId: { in: draftOrder } },
    select: {
      discordId: true,
      guildMembers: {
        where: { guildId: { in: taggedGuildIds } },
        select: { guildId: true },
      },
    },
  });

  // Discord snowflake -> tag (host guild takes priority over alliance guilds)
  const result = new Map<string, string>();
  for (const u of users) {
    const hostMembership = u.guildMembers.find((m) => m.guildId === hostGuildDbId);
    if (hostMembership) {
      const tag = guildDbIdToTag.get(hostMembership.guildId);
      if (tag) { result.set(u.discordId, tag); continue; }
    }
    for (const m of u.guildMembers) {
      const tag = guildDbIdToTag.get(m.guildId);
      if (tag) { result.set(u.discordId, tag); break; }
    }
  }
  return result;
}

async function postToAllianceThreads(
  eventId: string,
  embed: EmbedBuilder,
  row?: ActionRowBuilder<ButtonBuilder>,
  /** Leave the threads open (loot results: they close with the host's thread) */
  keepOpen = false,
) {
  const allianceGuilds = await prisma.eventAllianceGuild.findMany({
    where: { eventId },
    select: { threadId: true },
  });
  await Promise.allSettled(
    allianceGuilds
      .filter(({ threadId }) => threadId)
      .map(async ({ threadId }) => {
        const thread = await client.channels.fetch(threadId!);
        if (!thread?.isThread()) return;
        const wasArchived = thread.archived ?? false;
        if (wasArchived) await thread.setArchived(false).catch(() => null);
        await thread.send(row ? { embeds: [embed], components: [row] } : { embeds: [embed] });
        if (keepOpen) await thread.setAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek).catch(() => null);
        else if (wasArchived) await thread.setArchived(true).catch(() => null);
      }),
  );
}

function getNextPicker(position: number, draftOrder: string[]): string | null {
  if (draftOrder.length === 0) return null;
  const n = draftOrder.length;
  const round = Math.floor(position / n);
  const pos = position % n;
  return round % 2 === 0 ? draftOrder[pos]! : draftOrder[n - 1 - pos]!;
}

export async function announceDraftOrder(eventId: string) {
  const session = await prisma.lootSession.findUnique({ where: { eventId } });
  if (!session || session.method !== 'SNAKE_DRAFT') return;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event?.threadId) return;

  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) return;

  const tagMap = await buildDraftUserTagMap(eventId, draftOrder);
  const lines = draftOrder.map((userId, i) => {
    const tag = tagMap.get(userId);
    return tag ? `${i + 1}. <@${userId}> [${tag}]` : `${i + 1}. <@${userId}>`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🐍 Snake Draft Order Updated')
    .setDescription(lines)
    .setColor(0xf59e0b)
    .setTimestamp();

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send({ embeds: [embed] });
      if (wasArchived) await thread.setArchived(true).catch(() => null);
    }
  } catch (err) {
    console.error('[bot] Failed to announce draft order:', err);
  }

  await postToAllianceThreads(eventId, embed);
}

// ── Shared snake-draft turn notification core ─────────────────────────────────
// Called by both notifySnakeTurn (event-linked) and notifyStandaloneSnakeTurn.
// Handles role management, the DM attempt, and delegates the DM-failure fallback
// to the caller via onDmFail so each path can post to its own channel/thread.

async function handleSnakeTurnNotification(
  session: {
    draftOrder: string;
    guildId: string;
    skipCount: number;
    items: Array<{ assignments: unknown[] }>;
  },
  lootUrl: string,
  onDmFail: (nextPickerId: string, row: ActionRowBuilder<ButtonBuilder>) => Promise<void>,
): Promise<void> {
  const draftOrder: string[] = JSON.parse(session.draftOrder);
  if (draftOrder.length === 0) return;

  const allAssignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const totalUnassigned = session.items.filter((i) => i.assignments.length === 0).length;

  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) return;

  // Find or create the "Loot Picker" role
  let pickerRole = guild.roles.cache.find((r) => r.name === LOOT_PICKER_ROLE);
  if (!pickerRole) {
    pickerRole = await guild.roles.create({
      name: LOOT_PICKER_ROLE,
      color: 0xf59e0b,
      reason: 'Snake draft loot picker indicator',
    }).catch(() => null) ?? undefined;
  }

  // Remove role from any current holders — fetch only the role's members, not the whole guild
  if (pickerRole) {
    const freshRole = await guild.roles.fetch(pickerRole.id).catch(() => null);
    if (freshRole) {
      await Promise.allSettled(
        [...freshRole.members.values()].map((member) => member.roles.remove(freshRole).catch(() => null)),
      );
    }
  }

  // If all items assigned, we're done — no DM needed (only exit when items actually exist)
  if (session.items.length > 0 && totalUnassigned === 0) return;

  const effectivePosition = allAssignmentCount + session.skipCount;
  const nextPickerId = getNextPicker(effectivePosition, draftOrder);
  if (!nextPickerId) return;

  // Assign the picker role to the new picker
  if (pickerRole) {
    const nextMember = await guild.members.fetch(nextPickerId).catch(() => null);
    if (nextMember) await nextMember.roles.add(pickerRole).catch(() => null);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Loot Pool')
      .setStyle(ButtonStyle.Link)
      .setURL(lootUrl),
  );

  let dmSent = false;
  try {
    const discordUser = await client.users.fetch(nextPickerId);
    await discordUser.send({
      content: `🐍 It's your turn to pick in the snake draft!\n\nClick below to view the remaining loot and select your reward.`,
      components: [row],
    });
    dmSent = true;
  } catch {
    console.warn(`[bot] DM failed for snake draft picker ${nextPickerId}`);
  }

  if (!dmSent) {
    await onDmFail(nextPickerId, row);
  }
}

export async function notifySnakeTurn(eventId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { eventId },
    include: { items: { include: { assignments: true } } },
  });
  if (!session || session.method !== 'SNAKE_DRAFT' || session.status === 'COMPLETED') return;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/events/${eventId}/loot`;

  // Fetch event thread now — needed for DM fallback even if DM succeeds
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { threadId: true } });

  await handleSnakeTurnNotification(session, lootUrl, async (nextPickerId, row) => {
    const fallbackEmbed = new EmbedBuilder()
      .setDescription(`🐍 <@${nextPickerId}> — it's your turn to pick in the snake draft! *(DM delivery failed)*`)
      .setColor(0xf59e0b);

    // When DM fails post a ping to the event thread (and alliance threads) so the
    // draft doesn't stall silently. Cross-guild pickers with DMs off will see the
    // mention in their guild's alliance thread.
    if (event?.threadId) {
      try {
        const thread = await client.channels.fetch(event.threadId);
        if (thread?.isThread()) {
          const wasArchived = thread.archived ?? false;
          if (wasArchived) await thread.setArchived(false).catch(() => null);
          await thread.send({ embeds: [fallbackEmbed], components: [row] });
          if (wasArchived) await thread.setArchived(true).catch(() => null);
        }
      } catch (err) {
        console.error(`[bot] Thread fallback also failed for snake draft picker ${nextPickerId}:`, err);
      }
    }

    await postToAllianceThreads(eventId, fallbackEmbed, row);
  });
}

export async function notifyStandaloneSnakeTurn(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true } } },
  });
  if (!session || session.method !== 'SNAKE_DRAFT' || session.status === 'COMPLETED') return;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/loot/sessions/${sessionId}`;

  // Fetch loot channel now — needed for DM fallback
  const guildRecord = await prisma.guild.findUnique({
    where: { guildId: session.guildId },
    select: { settings: { select: { lootChannelId: true } } },
  });
  const lootChannelId = guildRecord?.settings?.lootChannelId ?? null;

  await handleSnakeTurnNotification(session, lootUrl, async (nextPickerId, row) => {
    if (!lootChannelId) return;
    try {
      const ch = await client.channels.fetch(lootChannelId);
      if (ch?.isTextBased() && 'send' in ch) {
        await ch.send({
          content: `🐍 <@${nextPickerId}> — it's your turn to pick in the snake draft! *(DM delivery failed)*`,
          components: [row],
        });
      }
    } catch (err) {
      console.error(`[bot] Loot-channel fallback also failed for standalone snake draft picker ${nextPickerId}:`, err);
    }
  });
}

export async function notifyLootComplete(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!session) return;

  type RawEntry = { name: string; qualityLevel: number | null; quantity: number; pickNumber: number | null; rollValue: number | null; dkpSpent: number | null };
  type WinnerEntry = { username: string; entries: RawEntry[] };
  const winners = new Map<string, WinnerEntry>();

  for (const item of session.items) {
    for (const a of item.assignments) {
      if (!winners.has(a.userId)) winners.set(a.userId, { username: a.username, entries: [] });
      winners.get(a.userId)!.entries.push({
        name: item.name,
        qualityLevel: item.qualityLevel,
        quantity: item.quantity,
        pickNumber: a.pickNumber,
        rollValue: a.rollValue,
        dkpSpent: a.dkpSpent,
      });
    }
  }

  if (winners.size === 0) return;

  // Resolve session label — prefer event name, fall back to session name or generic
  let sessionLabel = session.name ?? 'Loot Session';
  if (session.eventId) {
    const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } });
    if (event) sessionLabel = event.name;
  }

  // Batch-load notification prefs so we can skip opted-out users
  const winnerIds = [...winners.keys()];
  const usersWithPrefs = await prisma.user.findMany({
    where: { discordId: { in: winnerIds } },
    select: { discordId: true, notificationPrefs: { select: { dmLootComplete: true } } },
  });
  const prefsMap = new Map(usersWithPrefs.map((u) => [u.discordId, u.notificationPrefs]));

  // DM five winners at a time with a 1 s gap (as the event reminders do): opening
  // many DMs at once is what Discord's anti-spam watches for.
  const sendOne = async ([userId, { entries }]: [string, WinnerEntry]) => {
      const prefs = prefsMap.get(userId);
      // Unknown user (no DB record) or no saved prefs → default opt-in
      if (prefs !== undefined && prefs !== null && prefs.dmLootComplete === false) return;
      // Stack entries with identical name+QL — keep first pick number, sum count
      type StackedEntry = { name: string; qualityLevel: number | null; count: number; pickNumber: number | null; rollValue: number | null; dkpSpent: number | null };
      const stacked: StackedEntry[] = [];
      for (const e of entries) {
        const key = `${e.name}__${e.qualityLevel ?? ''}`;
        const existing = stacked.find((s) => `${s.name}__${s.qualityLevel ?? ''}` === key);
        if (existing) {
          existing.count += 1;
        } else {
          stacked.push({ name: e.name, qualityLevel: e.qualityLevel, count: 1, pickNumber: e.pickNumber, rollValue: e.rollValue, dkpSpent: e.dkpSpent });
        }
      }

      const lines = stacked.map((e) => {
        const ql = e.qualityLevel != null ? ` QL ${e.qualityLevel}` : '';
        const ct = e.count > 1 ? ` ×${e.count}` : '';
        let suffix = '';
        if (e.rollValue != null) suffix = ` (rolled ${e.rollValue})`;
        else if (e.dkpSpent != null && e.dkpSpent > 0) suffix = ` (${e.dkpSpent} DKP)`;
        else if (e.pickNumber != null) suffix = ` (pick #${e.pickNumber + 1})`;
        return `• ${e.name}${ql}${ct}${suffix}`;
      });

      const content = [
        `🎁 **Loot Session Complete — ${sessionLabel}**`,
        '',
        'Your items:',
        ...lines,
      ].join('\n');

      const discordUser = await client.users.fetch(userId);
      await discordUser.send({ content });
  };
  const all = [...winners.entries()];
  for (let i = 0; i < all.length; i += LOOT_DM_CHUNK) {
    if (i > 0) await sleep(1_000);
    const results = await Promise.allSettled(all.slice(i, i + LOOT_DM_CHUNK).map(sendOne));
    for (const r of results) if (r.status === 'rejected') console.warn('[loot] Loot-complete DM failed:', r.reason instanceof Error ? r.reason.message : r.reason);
  }
}

const LOOT_DM_CHUNK = 5;

const METHOD_LABELS: Record<string, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  SNAKE_DRAFT: '🐍 Snake Draft',
};

export async function announceLootSessionStart(sessionId: string) {
  const session = await prisma.lootSession.findUnique({ where: { id: sessionId } });
  if (!session || !session.eventId) return;

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event?.threadId) return;

  const dkpLabel = await getGuildDkpLabel(session.guildId);

  const methodLabel = session.method === 'DKP'
    ? `🪙 ${dkpLabel} Bid`
    : METHOD_LABELS[session.method] ?? session.method;

  const attendeeCount = event.confirmedAttendees
    ? (JSON.parse(event.confirmedAttendees) as string[]).length
    : 0;

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
  const lootUrl = `${webUrl}/dashboard/servers/${session.guildId}/events/${event.id}/loot`;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Method', value: methodLabel, inline: true },
    { name: 'Eligible Attendees', value: String(attendeeCount), inline: true },
  ];

  if (session.dkpAward > 0) {
    fields.push({
      name: `${dkpLabel} Award`,
      value: `+${session.dkpAward} ${dkpLabel} per attendee on completion`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎁 Loot Session Open — ${event.name}`)
    .setColor(0xf59e0b)
    .addFields(fields)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open Loot Session')
      .setStyle(ButtonStyle.Link)
      .setURL(lootUrl),
  );

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      const wasArchived = thread.archived ?? false;
      if (wasArchived) await thread.setArchived(false).catch(() => null);
      await thread.send({ embeds: [embed], components: [row] });
      if (wasArchived) await thread.setArchived(true).catch(() => null);
    }
  } catch (err) {
    console.error('[bot] Failed to announce loot session start:', err);
  }

  await postToAllianceThreads(session.eventId, embed, row);
}

export async function announceLootResults(sessionId: string) {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!session) return;

  // Event sessions post in the event's thread; standalone ones in the loot
  // results channel, if the server chose one (v1.22.0).
  const event = session.eventId ? await prisma.event.findUnique({ where: { id: session.eventId } }) : null;
  if (session.eventId && !event?.threadId) return;
  const label = event?.name ?? session.name ?? 'Loot session';

  const dkpLabel = await getGuildDkpLabel(session.guildId);

  const assignedItems = session.items.filter((i) => i.assignments.length > 0);

  // Build results embed only when items were assigned
  let embed: EmbedBuilder | null = null;
  if (assignedItems.length > 0) {
    let description: string;

    if (session.method === 'COMMODITY_DRAFT') {
      type StackedItem = { name: string; qualityLevel: number | null; count: number; pickNumber: number | null };
      const memberMap = new Map<string, { username: string; items: StackedItem[] }>();

      for (const item of assignedItems) {
        for (const a of item.assignments) {
          if (!memberMap.has(a.userId)) memberMap.set(a.userId, { username: a.username, items: [] });
          const member = memberMap.get(a.userId)!;
          const key = `${item.name}__${item.qualityLevel ?? ''}`;
          const existing = member.items.find((e) => `${e.name}__${e.qualityLevel ?? ''}` === key);
          if (existing) {
            existing.count += 1;
          } else {
            member.items.push({ name: item.name, qualityLevel: item.qualityLevel ?? null, count: 1, pickNumber: a.pickNumber });
          }
        }
      }

      const sections: string[] = [];
      for (const [, { username, items }] of memberMap) {
        const itemLines = items.map((e) => {
          const ql = e.qualityLevel != null ? ` QL ${e.qualityLevel}` : '';
          const ct = e.count > 1 ? ` ×${e.count}` : '';
          const pick = e.pickNumber != null ? ` (pick #${e.pickNumber + 1})` : '';
          return `• ${e.name}${ql}${ct}${pick}`;
        });
        sections.push(`**${username}:**\n${itemLines.join('\n')}`);
      }
      description = sections.join('\n\n');
    } else {
      const lines = assignedItems.map((item) => {
        const a = item.assignments[0]!;
        const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
        let suffix = '';
        if (a.rollValue != null) suffix = ` *(rolled ${a.rollValue})*`;
        else if (a.dkpSpent != null) suffix = ` *(${a.dkpSpent} ${dkpLabel})*`;
        else if (a.pickNumber != null) suffix = ` *(pick #${a.pickNumber + 1})*`;
        return `**${item.name}${qty}** → <@${a.userId}>${suffix}`;
      });
      description = lines.join('\n');
    }

    const methodLabel = session.method === 'DKP'
      ? `🪙 ${dkpLabel}`
      : METHOD_LABELS[session.method] ?? session.method;

    embed = new EmbedBuilder()
      .setTitle(`🎁 Loot — ${label}`)
      .setColor(0xf59e0b)
      .setDescription(description)
      .setFooter({ text: `Method: ${methodLabel}` })
      .setTimestamp();

    if (event && session.dkpAward > 0) {
      const confirmedIds: string[] = event.confirmedAttendees
        ? JSON.parse(event.confirmedAttendees)
        : [];
      embed.addFields({
        name: `🪙 ${dkpLabel} Awarded`,
        value: `+${session.dkpAward} ${dkpLabel} to ${confirmedIds.length} attendee${confirmedIds.length !== 1 ? 's' : ''}`,
        inline: false,
      });
    }
  }

  if (!event) {
    if (embed) await postToLootChannel(session.guildId, embed);
    return;
  }

  // The thread stays open while the loot is handed out: until every item is
  // marked delivered, or LOOT_THREAD_HOLD_MS after the loot (v1.22.0).
  const holding = assignedItems.length > 0 && !!session.completedAt;
  try {
    const thread = await client.channels.fetch(event.threadId!);
    if (thread?.isThread()) {
      if (thread.archived) await thread.setArchived(false).catch(() => null);
      if (embed) await thread.send({ embeds: [embed] });
      if (holding) {
        // Discord would otherwise archive a quiet thread sooner; we close it ourselves.
        await thread.setAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek).catch(() => null);
      } else {
        await thread.setArchived(true).catch(() => null);
      }
    }
  } catch (err) {
    console.error('[bot] Failed to post loot results:', err);
  }

  if (embed) await postToAllianceThreads(session.eventId!, embed, undefined, holding);
  if (!holding) {
    await prisma.lootSession.update({ where: { id: session.id }, data: { threadClosedAt: new Date() } }).catch(() => null);
  } else {
    await closeLootThreadIfDone(session.id); // everything already delivered
  }
}

/** Standalone sessions: the loot results channel (GuildSettings.lootChannelId), if set. */
async function postToLootChannel(guildId: string, embed: EmbedBuilder): Promise<void> {
  const g = await prisma.guild.findUnique({ where: { guildId }, select: { settings: { select: { lootChannelId: true } } } });
  const channelId = g?.settings?.lootChannelId;
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch?.isTextBased() && 'send' in ch) await ch.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`[bot] Couldn't post loot results in the loot channel of ${guildId}:`, err);
  }
}

// ── Closing the event thread after the loot (v1.22.0) ─────────────────────────

/** How long an event's thread stays open after its loot, unless everything is delivered sooner. */
export const LOOT_THREAD_HOLD_MS = 72 * 60 * 60_000;

/** Why a completed event loot session's thread should close now, or null to keep it open. */
export function lootThreadCloseReason(
  completedAt: Date,
  assignments: readonly { delivered: boolean }[],
  now = Date.now(),
): 'delivered' | 'expired' | null {
  if (assignments.length > 0 && assignments.every((a) => a.delivered)) return 'delivered';
  if (now - completedAt.getTime() >= LOOT_THREAD_HOLD_MS) return 'expired';
  return null;
}

const CLOSE_NOTICE = {
  delivered: '📦 All loot has been delivered. Closing this thread.',
  expired: '🔒 Closing this thread: it\'s been 72 hours since the loot was handed out.',
} as const;

/** Closes the event's thread (and allies' threads) if the session's loot is delivered or the hold is over. */
export async function closeLootThreadIfDone(sessionId: string, now = Date.now()): Promise<boolean> {
  const session = await prisma.lootSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { assignments: { select: { delivered: true } } } } },
  });
  if (!session?.eventId || session.status !== 'COMPLETED' || !session.completedAt || session.threadClosedAt) return false;
  const why = lootThreadCloseReason(session.completedAt, session.items.flatMap((i) => i.assignments), now);
  if (!why) return false;

  // Claim it first, so two ticks (or a tick and a delivery) don't both post.
  const claimed = await prisma.lootSession.updateMany({ where: { id: sessionId, threadClosedAt: null }, data: { threadClosedAt: new Date(now) } });
  if (claimed.count === 0) return false;

  const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { threadId: true } });
  const allies = await prisma.eventAllianceGuild.findMany({ where: { eventId: session.eventId, threadId: { not: null } }, select: { threadId: true } });
  await Promise.allSettled([event?.threadId, ...allies.map((a) => a.threadId)].filter((t): t is string => !!t).map(async (threadId) => {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread?.isThread()) return;
    if (thread.archived) return; // already closed (by hand, or by Discord)
    await thread.send(CLOSE_NOTICE[why]).catch(() => null);
    await thread.setArchived(true).catch((err) => console.warn(`[bot] Couldn't close thread ${threadId} after loot:`, err));
  }));
  return true;
}

/** Scheduler backstop: closes threads whose hold is over (or that were all delivered while the bot was down). */
export async function checkLootThreadHolds(): Promise<void> {
  const open = await prisma.lootSession.findMany({
    where: { status: 'COMPLETED', eventId: { not: null }, completedAt: { not: null }, threadClosedAt: null },
    select: { id: true },
    take: 20,
  });
  for (const { id } of open) await closeLootThreadIfDone(id);
}
