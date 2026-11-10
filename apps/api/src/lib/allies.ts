// Ally network: database side. Every decision about what is allowed comes
// from the shared rules (packages/shared/src/allies.ts); this file loads rows,
// applies those decisions and shapes the responses.

import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Guild, GuildAlly, GuildSettings } from '@prisma/client';
import {
  ALLY_MAX_OUTGOING,
  ALLY_MESSAGE_MAX,
  allyCodeFromBytes,
  allyRefusalMessage,
  autoAcceptField,
  decideAllyChange,
  decideCancel,
  decideRequest,
  decideResponse,
  decideUnblock,
  normalizeAllyCode,
  otherGuild,
  pairsFromAlliances,
  responseChanges,
  sortPair,
  type AllyNoticeEvent,
  type AllyNoticePayload,
  type AllyBlockDto,
  type AllyDirectoryEntryDto,
  type AllyDto,
  type AllyGuildDto,
  type AllyOutgoingDto,
  type AllyRefusal,
  type AllyRequestDto,
  type AlliesOverviewDto,
  type SendAllyRequestResult,
} from '@dem/shared';
import { prisma } from './prisma.js';
import { triggerBot } from './triggerBot.js';

type GuildWithSettings = Guild & { settings: GuildSettings | null };

/** A refused action: `status` is the HTTP status to answer with. */
export class AllyError extends Error {
  constructor(public status: number, message: string, public refusal?: AllyRefusal) {
    super(message);
  }
}

/** 403 for acting on someone else's request or link, 400 for asking yourself, 409 for the rest (wrong state). */
function refuse(refusal: AllyRefusal, retryAfter?: Date): never {
  const status = refusal === 'not-yours' ? 403 : refusal === 'self' ? 400 : 409;
  throw new AllyError(status, allyRefusalMessage(refusal, retryAfter), refusal);
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function loadGuild(discordGuildId: string): Promise<GuildWithSettings> {
  const guild = await prisma.guild.findUnique({ where: { guildId: discordGuildId }, include: { settings: true } });
  if (!guild) throw new AllyError(404, 'Server not found');
  return guild;
}

export function toGuildDto(g: GuildWithSettings): AllyGuildDto {
  return {
    guildId: g.guildId,
    name: g.name,
    icon: g.icon,
    allianceTag: g.settings?.allianceTag ?? null,
    rsiOrgTag: g.settings?.rsiOrgTag ?? null,
  };
}

async function findLink(x: string, y: string): Promise<GuildAlly | null> {
  const [guildAId, guildBId] = sortPair(x, y);
  return prisma.guildAlly.findUnique({ where: { guildAId_guildBId: { guildAId, guildBId } } });
}

/** A link the guild is part of, by id. 404 for anything else, so ids of other orgs' links reveal nothing. */
async function loadOwnLink(guild: Guild, linkId: string): Promise<GuildAlly> {
  const link = await prisma.guildAlly.findUnique({ where: { id: linkId } });
  if (!link || (link.guildAId !== guild.id && link.guildBId !== guild.id)) throw new AllyError(404, 'Not found');
  return link;
}

/** Applies an update only if the row is still in the state it was read in; a race answers 409. */
async function updateIf(link: GuildAlly, data: Prisma.GuildAllyUpdateManyMutationInput): Promise<void> {
  const r = await prisma.guildAlly.updateMany({ where: { id: link.id, status: link.status, requestedByGuildId: link.requestedByGuildId }, data });
  if (r.count === 0) throw new AllyError(409, 'This changed while you were looking at it. Refresh and try again.');
}

async function deleteIf(link: GuildAlly): Promise<void> {
  const r = await prisma.guildAlly.deleteMany({ where: { id: link.id, status: link.status } });
  if (r.count === 0) throw new AllyError(409, 'This changed while you were looking at it. Refresh and try again.');
}

/** Tells the bot to post or update the Discord ally notices (v1.10.0). */
function notify(event: AllyNoticeEvent, link: Pick<GuildAlly, 'id' | 'noticeChannelId' | 'noticeMessageId'>, actorGuildId: string, otherGuildId: string, actor: Actor | null): void {
  const payload: AllyNoticePayload = {
    event, linkId: link.id, actorGuildId, otherGuildId, actorUserId: actor?.userId ?? null,
    noticeChannelId: link.noticeChannelId, noticeMessageId: link.noticeMessageId,
  };
  triggerBot('/trigger/ally', payload);
}

// ── Ally code ────────────────────────────────────────────────────────────────

/** The guild's ally code, created (with its settings row, if missing) on first use. */
export async function ensureAllyCode(guild: GuildWithSettings): Promise<string> {
  if (guild.settings?.allyCode) return guild.settings.allyCode;
  return setNewAllyCode(guild);
}

export async function setNewAllyCode(guild: Guild): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = allyCodeFromBytes(randomBytes(8));
    try {
      await prisma.guildSettings.upsert({
        where: { guildId: guild.id },
        create: { guildId: guild.id, allyCode: code },
        update: { allyCode: code },
      });
      return code;
    } catch (err) {
      // Another org already has this code (32^8 ≈ 10^12 codes, so this is rare): try another.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
  throw new AllyError(500, 'Could not create an ally code. Try again.');
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function alliesOverview(guild: GuildWithSettings): Promise<AlliesOverviewDto> {
  const links = await prisma.guildAlly.findMany({
    where: { OR: [{ guildAId: guild.id }, { guildBId: guild.id }] },
    include: { guildA: { include: { settings: true } }, guildB: { include: { settings: true } } },
    orderBy: { requestedAt: 'desc' },
  });
  const other = (l: (typeof links)[number]) => toGuildDto(l.guildAId === guild.id ? l.guildB : l.guildA);
  const now = new Date();

  const allies: AllyDto[] = [];
  const incoming: AllyRequestDto[] = [];
  const outgoing: AllyOutgoingDto[] = [];
  const blocked: AllyBlockDto[] = [];
  for (const l of links) {
    const mine = l.requestedByGuildId === guild.id;
    if (l.status === 'ACCEPTED') {
      allies.push({
        id: l.id, guild: other(l), since: (l.acceptedAt ?? l.respondedAt ?? l.requestedAt).toISOString(),
        autoAcceptTheirEvents: l[autoAcceptField(l, guild.id)],
      });
    } else if (l.status === 'PENDING') {
      const r = { id: l.id, guild: other(l), message: l.message, requestedAt: l.requestedAt.toISOString() };
      if (mine) outgoing.push({ ...r, status: 'PENDING', retryAfter: null });
      else incoming.push(r);
    } else if (l.status === 'REJECTED') {
      // Only the rejected org sees it, and only while its wait lasts.
      if (mine && l.retryAfter && l.retryAfter > now) {
        outgoing.push({ id: l.id, guild: other(l), message: l.message, requestedAt: l.requestedAt.toISOString(), status: 'REJECTED', retryAfter: l.retryAfter.toISOString() });
      }
    } else if (l.status === 'BLOCKED' && l.blockedByGuildId === guild.id) {
      // The blocked org is never told.
      blocked.push({ id: l.id, guild: other(l), blockedAt: (l.respondedAt ?? l.requestedAt).toISOString() });
    }
  }
  allies.sort((a, b) => a.guild.name.localeCompare(b.guild.name));
  return {
    allies, incoming, outgoing, blocked,
    listing: { listed: guild.settings?.allyDirectoryListed ?? false, code: await ensureAllyCode(guild) },
    pendingCount: incoming.length,
  };
}

/** Incoming requests waiting for an answer (the nav badge), without building the whole overview. */
export async function pendingAllyRequestCount(guild: Guild): Promise<number> {
  return prisma.guildAlly.count({
    where: { status: 'PENDING', NOT: { requestedByGuildId: guild.id }, OR: [{ guildAId: guild.id }, { guildBId: guild.id }] },
  });
}

// ── Directory ────────────────────────────────────────────────────────────────

/**
 * Listed orgs whose name or tag contains `q`. Orgs that blocked you never show;
 * orgs you're already allied or in a pending request with are left out (they're
 * on your Allies page already).
 */
export async function searchDirectory(guild: Guild, q: string): Promise<AllyDirectoryEntryDto[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const candidates = await prisma.guild.findMany({
    where: {
      id: { not: guild.id },
      settings: { allyDirectoryListed: true },
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { settings: { allianceTag: { equals: term, mode: 'insensitive' } } },
        { settings: { rsiOrgTag: { equals: term, mode: 'insensitive' } } },
      ],
    },
    include: { settings: true },
    orderBy: { name: 'asc' },
    take: 40,
  });
  const now = new Date();
  const out: AllyDirectoryEntryDto[] = [];
  for (const g of candidates) {
    const link = await findLink(guild.id, g.id);
    if (link && (link.status === 'ACCEPTED' || link.status === 'PENDING')) continue;
    if (link?.status === 'BLOCKED' && link.blockedByGuildId === g.id) continue; // they blocked you
    const d = decideRequest(link, guild.id, g.id, now);
    out.push({ guild: toGuildDto(g), requestable: d.ok, reason: d.ok ? null : allyRefusalMessage(d.refusal, d.retryAfter) });
    if (out.length >= 20) break;
  }
  return out;
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface Actor {
  /** Discord user id of whoever clicked. */
  userId: string;
}

/** Sends a request to a listed org, or to any org by its ally code. */
export async function sendAllyRequest(
  guild: GuildWithSettings,
  target: { targetGuildId?: string; code?: string },
  rawMessage: string | undefined,
  actor: Actor,
): Promise<SendAllyRequestResult> {
  const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.trim() : null;
  if (message && message.length > ALLY_MESSAGE_MAX) throw new AllyError(400, `The message can be at most ${ALLY_MESSAGE_MAX} characters.`);

  let to: GuildWithSettings | null = null;
  if (target.code !== undefined) {
    const code = normalizeAllyCode(target.code);
    if (!code) throw new AllyError(400, 'That isn\'t a valid ally code. Codes are 8 letters and numbers, like ABCD-EFGH.');
    const s = await prisma.guildSettings.findUnique({ where: { allyCode: code }, include: { guild: { include: { settings: true } } } });
    to = s?.guild ?? null;
    if (!to) throw new AllyError(404, 'No org has that ally code.');
  } else if (target.targetGuildId) {
    to = await prisma.guild.findUnique({ where: { guildId: target.targetGuildId }, include: { settings: true } });
    // Unlisted orgs can only be reached by code; answer as if they don't exist.
    if (!to || !to.settings?.allyDirectoryListed) throw new AllyError(404, 'Org not found in the ally directory.');
  } else {
    throw new AllyError(400, 'Choose an org from the directory or enter its ally code.');
  }
  if (to.id === guild.id) refuse('self');

  const now = new Date();
  for (let attempt = 0; attempt < 2; attempt++) {
    const link = await findLink(guild.id, to.id);
    const d = decideRequest(link, guild.id, to.id, now);
    if (!d.ok) refuse(d.refusal, d.retryAfter);

    if (d.action === 'accept') {
      // They had already asked: this accepts their request.
      await updateIf(link!, responseChanges('accept', guild.id, actor.userId, now));
      notify('accepted', link!, guild.id, to.id, actor);
      return { outcome: 'accepted', guild: toGuildDto(to) };
    }

    const open = await prisma.guildAlly.count({ where: { status: 'PENDING', requestedByGuildId: guild.id } });
    if (open >= ALLY_MAX_OUTGOING) {
      throw new AllyError(429, `You have ${ALLY_MAX_OUTGOING} requests waiting for an answer. Cancel one or wait for replies before sending more.`);
    }

    const fields = {
      status: 'PENDING' as const, requestedByGuildId: guild.id, message, requestedBy: actor.userId, requestedAt: now,
      respondedAt: null, respondedBy: null, retryAfter: null, blockedByGuildId: null, acceptedAt: null,
      noticeChannelId: null, noticeMessageId: null,
    };
    if (d.action === 'reopen') {
      await updateIf(link!, fields);
      notify('requested', { id: link!.id, noticeChannelId: null, noticeMessageId: null }, guild.id, to.id, actor);
      return { outcome: 'requested', guild: toGuildDto(to) };
    }
    const [guildAId, guildBId] = sortPair(guild.id, to.id);
    try {
      const created = await prisma.guildAlly.create({ data: { guildAId, guildBId, ...fields } });
      notify('requested', created, guild.id, to.id, actor);
      return { outcome: 'requested', guild: toGuildDto(to) };
    } catch (err) {
      // The other org asked at the same moment: decide again with their row in place.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt === 0) continue;
      throw err;
    }
  }
  throw new AllyError(409, 'This changed while you were looking at it. Refresh and try again.');
}

export async function respondToAllyRequest(
  guild: Guild,
  linkId: string,
  action: 'accept' | 'reject' | 'block',
  actor: Actor,
): Promise<void> {
  const link = await loadOwnLink(guild, linkId);
  const d = decideResponse(link, guild.id);
  if (!d.ok) refuse(d.refusal);
  await updateIf(link, responseChanges(action, guild.id, actor.userId, new Date()));
  const event = ({ accept: 'accepted', reject: 'rejected', block: 'blocked' } as const)[action];
  notify(event, link, guild.id, otherGuild(link, guild.id), actor);
}

export async function cancelAllyRequest(guild: Guild, linkId: string, actor: Actor): Promise<void> {
  const link = await loadOwnLink(guild, linkId);
  const d = decideCancel(link, guild.id);
  if (!d.ok) refuse(d.refusal);
  await deleteIf(link);
  notify('cancelled', link, guild.id, otherGuild(link, guild.id), actor);
}

// ── Allies ───────────────────────────────────────────────────────────────────

/** Ends an alliance. Either side may; it isn't a rejection, so either can ask again right away. */
export async function removeAlly(guild: Guild, linkId: string, actor: Actor): Promise<void> {
  const link = await loadOwnLink(guild, linkId);
  const d = decideAllyChange(link, guild.id);
  if (!d.ok) refuse(d.refusal);
  await deleteIf(link);
  notify('removed', link, guild.id, otherGuild(link, guild.id), actor);
}

/** Your own setting for one ally: post their shared events without asking (used from v2.0.0). */
export async function setAllyAutoAccept(guild: Guild, linkId: string, value: boolean): Promise<void> {
  const link = await loadOwnLink(guild, linkId);
  const d = decideAllyChange(link, guild.id);
  if (!d.ok) refuse(d.refusal);
  await updateIf(link, { [autoAcceptField(link, guild.id)]: value });
}

export async function unblockAlly(guild: Guild, linkId: string): Promise<void> {
  const link = await loadOwnLink(guild, linkId);
  const d = decideUnblock(link, guild.id);
  if (!d.ok) refuse(d.refusal);
  await deleteIf(link);
}

// ── Listing ──────────────────────────────────────────────────────────────────

export async function setDirectoryListing(guild: Guild, listed: boolean): Promise<void> {
  await prisma.guildSettings.upsert({
    where: { guildId: guild.id },
    create: { guildId: guild.id, allyDirectoryListed: listed },
    update: { allyDirectoryListed: listed },
  });
}

// ── Migration from the old alliances ─────────────────────────────────────────

/**
 * Copies accepted alliance memberships and 1-to-1 ally links into GuildAlly as
 * accepted pairs (approve-each for events, as alliance shares behave today).
 * Only inserts pairs that don't exist yet, so it is safe on every start-up.
 * Remove once the Alliance tables are retired (v2.0.1).
 */
export async function migrateLegacyAlliances(): Promise<{ created: number; existing: number; droppedPending: string[] }> {
  const alliances = await prisma.alliance.findMany({
    include: { members: { select: { guildId: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (alliances.length === 0) return { created: 0, existing: 0, droppedPending: [] };

  const { pairs, droppedPending } = pairsFromAlliances(alliances);
  const names = new Map((await prisma.guild.findMany({ select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const createdAt = new Map(alliances.map((a) => [a.id, a.createdAt.getTime()]));

  let created = 0, existing = 0;
  const lines: string[] = [];
  for (const p of pairs) {
    // "Allies since" = when the oldest alliance that linked them was made.
    const since = new Date(Math.min(...p.allianceIds.map((id) => createdAt.get(id) ?? Date.now())));
    const r = await prisma.guildAlly.createMany({
      data: [{ guildAId: p.guildAId, guildBId: p.guildBId, status: 'ACCEPTED', requestedByGuildId: p.guildAId, requestedAt: since, respondedAt: since, acceptedAt: since }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      created++;
      lines.push(`${names.get(p.guildAId) ?? p.guildAId} + ${names.get(p.guildBId) ?? p.guildBId} (from ${p.from.join(', ')})`);
    } else existing++;
  }
  const dropped = droppedPending.map((d) => `${names.get(d.guildId) ?? d.guildId} invited to ${d.allianceName}`);
  if (created > 0 || dropped.length > 0) {
    console.log(`[allies] Migrated ${created} ally pair(s) from ${alliances.length} old alliance(s); ${existing} already existed.`
      + (lines.length ? ` New: ${lines.join('; ')}.` : '')
      + (dropped.length ? ` Pending invitations not carried over: ${dropped.join('; ')}.` : ''));
  }
  return { created, existing, droppedPending: dropped };
}

export async function migrateLegacyAlliancesOnStartup(): Promise<void> {
  try {
    await migrateLegacyAlliances();
  } catch (err) {
    console.error('[allies] Migrating old alliances failed:', err instanceof Error ? err.message : err);
  }
}

