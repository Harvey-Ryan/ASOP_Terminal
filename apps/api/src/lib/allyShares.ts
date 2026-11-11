import type { EventGuildShare, GuildAlly } from '@prisma/client';
import {
  canShareEvents,
  otherGuild,
  planShares,
  receiverAutoAccepts,
  type SharePlan,
  type ShareNoticeEvent,
  type ShareNoticePayload,
  type ShareableAlliesDto,
} from '@dem/shared';
import { prisma } from './prisma.js';
import { triggerBot } from './triggerBot.js';
import { toGuildDto } from './allies.js';

// Sharing events with allies (v1.11.0). Rules: packages/shared/src/allies.ts
// (planShares, withdrawnOnRemoval). Guild ids here are internal Guild.id unless
// a name says Discord.

/** The host's accepted ally links. */
async function allyLinksOf(hostGuildId: string): Promise<GuildAlly[]> {
  return prisma.guildAlly.findMany({
    where: { status: 'ACCEPTED', OR: [{ guildAId: hostGuildId }, { guildBId: hostGuildId }] },
  });
}

/**
 * Plans a share of the host's event with these Discord guilds. Unknown guilds
 * count as not allies. `names` maps every target to a display name.
 */
export async function planEventShares(hostGuildId: string, targetDiscordIds: readonly string[]): Promise<SharePlan & { names: Map<string, string> }> {
  const ids = [...new Set(targetDiscordIds.filter((x) => typeof x === 'string' && x.length > 0))];
  const guilds = await prisma.guild.findMany({ where: { guildId: { in: ids } }, select: { id: true, guildId: true, name: true } });
  const internalByDiscord = new Map(guilds.map((g) => [g.guildId, g.id]));
  const names = new Map<string, string>(guilds.map((g) => [g.id, g.name]));
  const plan = planShares(hostGuildId, guilds.map((g) => g.id), await allyLinksOf(hostGuildId));
  for (const d of ids) if (!internalByDiscord.has(d)) { plan.notAllies.push(d); names.set(d, 'an unknown server'); }
  return { ...plan, names };
}

export function notAllyError(plan: { notAllies: string[]; names: Map<string, string> }): string {
  const who = plan.notAllies.map((id) => plan.names.get(id) ?? id).join(', ');
  return `You can only share events with your allies, and ${who} ${plan.notAllies.length === 1 ? 'isn\'t one' : 'aren\'t'} yet. Add them on the Allies page first.`;
}

/** Tells the bot to post or update a shared event's Accept / Decline notice. */
export function notifyShare(
  event: ShareNoticeEvent,
  share: Pick<EventGuildShare, 'id' | 'eventId' | 'guildId' | 'noticeChannelId' | 'noticeMessageId'>,
  hostGuildId: string,
  actorUserId: string | null,
): void {
  const payload: ShareNoticePayload = {
    event, shareId: share.id, eventId: share.eventId, hostGuildId, receiverGuildId: share.guildId,
    actorUserId, noticeChannelId: share.noticeChannelId, noticeMessageId: share.noticeMessageId,
  };
  triggerBot('/trigger/share-notice', payload);
}

/**
 * Creates the shares a plan calls for. Allies that post automatically get an
 * ACCEPTED share and the bot posts the event in their server; the rest get a
 * PENDING invitation and an Accept / Decline notice. Existing shares for the
 * event are left alone.
 */
export async function createPlannedShares(eventId: string, hostGuildId: string, plan: Pick<SharePlan, 'accepted' | 'pending'>): Promise<void> {
  const now = new Date();
  const rows = [
    ...plan.accepted.map((guildId) => ({ eventId, guildId, sourceType: 'DIRECT' as const, status: 'ACCEPTED' as const, autoAccepted: true, respondedAt: now })),
    ...plan.pending.map((guildId) => ({ eventId, guildId, sourceType: 'DIRECT' as const, status: 'PENDING' as const })),
  ];
  if (rows.length === 0) return;
  const before = await prisma.eventGuildShare.findMany({ where: { eventId }, select: { guildId: true } });
  const had = new Set(before.map((s) => s.guildId));
  await prisma.eventGuildShare.createMany({ data: rows.filter((r) => !had.has(r.guildId)), skipDuplicates: true });
  const created = await prisma.eventGuildShare.findMany({
    where: { eventId, guildId: { in: rows.map((r) => r.guildId).filter((g) => !had.has(g)) } },
  });
  for (const s of created) {
    if (s.status === 'ACCEPTED') triggerBot(`/trigger/share-accepted/${s.id}`);
    else notifyShare('pending', s, hostGuildId, null);
  }
}

/** The host's allies for the event form's picker. */
export async function shareableAllies(hostDiscordId: string): Promise<ShareableAlliesDto | null> {
  const host = await prisma.guild.findUnique({ where: { guildId: hostDiscordId }, include: { settings: true } });
  if (!host) return null;
  const links = (await allyLinksOf(host.id)).filter(canShareEvents);
  const others = await prisma.guild.findMany({
    where: { id: { in: links.map((l) => otherGuild(l, host.id)) } },
    include: { settings: true },
  });
  const byId = new Map(others.map((g) => [g.id, g]));
  const allies = links
    .flatMap((l) => {
      const g = byId.get(otherGuild(l, host.id));
      return g ? [{ guild: toGuildDto(g), postsAutomatically: receiverAutoAccepts(l, g.id) }] : [];
    })
    .sort((a, b) => a.guild.name.localeCompare(b.guild.name));
  return { host: toGuildDto(host), allies };
}

/**
 * Ending an alliance withdraws the invitations still waiting between the two
 * orgs, both ways (accepted shares stay until their events end). Returns how
 * many were withdrawn.
 */
export async function withdrawPendingShares(pair: Pick<GuildAlly, 'guildAId' | 'guildBId'>, actorUserId: string | null): Promise<number> {
  const guilds = await prisma.guild.findMany({ where: { id: { in: [pair.guildAId, pair.guildBId] } }, select: { id: true, guildId: true } });
  const discordOf = new Map(guilds.map((g) => [g.id, g.guildId]));
  const a = discordOf.get(pair.guildAId), b = discordOf.get(pair.guildBId);
  if (!a || !b) return 0;
  const shares = await prisma.eventGuildShare.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { guildId: pair.guildBId, event: { guildId: a } },
        { guildId: pair.guildAId, event: { guildId: b } },
      ],
    },
  });
  if (shares.length === 0) return 0;
  // Only rows still PENDING go: one answered a moment ago stays as answered.
  await prisma.eventGuildShare.deleteMany({ where: { id: { in: shares.map((s) => s.id) }, status: 'PENDING' } });
  const left = new Set((await prisma.eventGuildShare.findMany({ where: { id: { in: shares.map((s) => s.id) } }, select: { id: true } })).map((s) => s.id));
  let withdrawn = 0;
  for (const s of shares) {
    if (left.has(s.id)) continue;
    withdrawn++;
    const host = s.guildId === pair.guildAId ? pair.guildBId : pair.guildAId;
    notifyShare('withdrawn', s, host, actorUserId);
  }
  return withdrawn;
}
