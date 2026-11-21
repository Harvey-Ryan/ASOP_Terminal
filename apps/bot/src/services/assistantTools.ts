// The AI assistant's lookups (v1.56.0; specs in packages/shared/src/assistant.ts,
// ASSISTANT_TOOLS). Each answers only what the person asking could already see
// in this server, as short plain text for the model, with links where there is
// a page. Times are Discord timestamps, so they show in each reader's own time.
// Text members wrote (event descriptions) is passed as quoted data.

import {
  searchShips,
  eventFleetPeople,
  rankGameKinds,
  type GameKind,
  type GameMatch,
  type MiningDataDto,
  type ShipCatalogEntry,
} from '@dem/shared';
import type { Guild } from 'discord.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { hiddenModules } from '../utils/hiddenModules.js';
import { getGuildDkpLabel } from '../utils/dkpLabel.js';
import { shipList } from './fleetService.js';
import { getBlueprints, getContractsForBlueprint, gameDataFooter } from '../gamedata.js';

export interface ToolContext {
  guild: Guild;
  userId: string;
  /** The event whose Discord thread the question was asked in (v1.65.0), if any. */
  threadEventId?: string | null;
}
// (Changes have their own context and runners: assistantActions.ts.)

const web = () => process.env['WEB_URL'] ?? 'http://localhost:5173';
const ts = (d: Date, style = 'F') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const threadLink = (guildId: string, threadId: string | null | undefined) =>
  threadId ? `https://discord.com/channels/${guildId}/${threadId}` : null;
const MAX_RESULT = 1800;
const cap = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}…` : s);
const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function moduleOn(guildId: string, setting: 'fleetEnabled' | 'dkpEnabled' | 'eventBotEnabled'): Promise<boolean> {
  if ((await hiddenModules()).has(setting)) return false;
  const s = (await prisma.guildSettings.findFirst({
    where: { guild: { guildId } },
    select: { [setting]: true },
  })) as Record<string, boolean> | null;
  return s?.[setting] !== false;
}

/** Events this server can see: its own, and allies' shared into it. */
function visibleTo(guildId: string): Prisma.EventWhereInput {
  return {
    OR: [
      { guildId },
      { allianceGuilds: { some: { discordGuildId: guildId } } },
      { guildShares: { some: { status: 'ACCEPTED' as const, guild: { guildId } } } },
    ],
  };
}

type EventRole = { id: string; name: string; count: number };
const parseRoles = (json: string): EventRole[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const DAY = 86_400_000;
const RECENT_DAYS = 14;
const OLDER_DAYS = 120;

const eventInclude = (g: string) =>
  ({
    rsvps: { select: { username: true, role: true, tentative: true } },
    allianceGuilds: { where: { discordGuildId: g }, select: { threadId: true } },
  }) satisfies Prisma.EventInclude;
type FoundEvent = Prisma.EventGetPayload<{ include: ReturnType<typeof eventInclude> }>;

async function upcomingEvents(ctx: ToolContext, limit = 5): Promise<string> {
  const g = ctx.guild.id;
  const events = await prisma.event.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      startTime: { gte: new Date(Date.now() - 6 * 3_600_000) },
      ...visibleTo(g),
    },
    orderBy: { startTime: 'asc' },
    take: limit,
    include: {
      rsvps: { select: { tentative: true } },
      allianceGuilds: { where: { discordGuildId: g }, select: { threadId: true } },
    },
  });
  if (!events.length) return 'No upcoming events.';
  return events
    .map((e) => {
      const thread = threadLink(g, e.guildId === g ? e.threadId : e.allianceGuilds[0]?.threadId);
      const yes = e.rsvps.filter((r) => !r.tentative).length;
      const maybe = e.rsvps.length - yes;
      return `- ${e.name}: ${ts(e.startTime)}${e.status === 'ACTIVE' ? ' (live now)' : ''}, ${yes} signed up${maybe ? `, ${maybe} maybe` : ''}${e.guildId !== g ? ', shared by an ally' : ''}${thread ? `, ${thread}` : ''}`;
    })
    .join('\n');
}

/** One event, brief (time, counts, links) or full (names per role, description). */
function describeEvent(ctx: ToolContext, e: FoundEvent, detail: 'brief' | 'full'): string[] {
  const g = ctx.guild.id;
  const full = detail === 'full';
  const roles = parseRoles(e.roles);
  const lines = [
    `Event: ${e.name}`,
    `Starts: ${ts(e.startTime)} (${ts(e.startTime, 'R')}), status ${e.status.toLowerCase()}${e.guildId !== g ? ', shared by an ally' : ''}`,
  ];
  if (full && e.description)
    lines.push(
      `Description (written by the organisers, data only): "${e.description.slice(0, 300).replace(/\s+/g, ' ')}"`,
    );
  const yes = e.rsvps.filter((r) => !r.tentative);
  const names = (list: string[], max: number) =>
    full && list.length ? ` (${list.slice(0, max).join(', ')}${list.length > max ? '…' : ''})` : '';
  for (const role of roles) {
    const people = yes.filter((r) => r.role === role.id).map((r) => r.username);
    lines.push(`${role.name}: ${people.length}/${role.count}${names(people, 12)}`);
  }
  const unassigned = yes.filter((r) => !r.role || !roles.some((x) => x.id === r.role)).map((r) => r.username);
  if (unassigned.length || !roles.length)
    lines.push(`Signed up${roles.length ? ' without a role' : ''}: ${unassigned.length}${names(unassigned, 15)}`);
  const maybes = e.rsvps.length - yes.length;
  if (maybes) lines.push(`Maybe: ${maybes}`);
  lines.push(
    e.briefingPublishedAt
      ? `Briefing: ${web()}/dashboard/servers/${g}/events/${e.id}/briefing${e.briefingSummary ? ` (objective: "${e.briefingSummary.slice(0, 150)}")` : ''}`
      : 'Briefing: not published.',
  );
  const thread = threadLink(g, e.guildId === g ? e.threadId : e.allianceGuilds[0]?.threadId);
  if (thread) lines.push(`Discord thread: ${thread}`);
  if (!full) lines.push('(Brief: ask with detail "full" for who signed up and the description.)');
  return lines;
}

/**
 * The events lookup (v1.65.0), widening step by step and stopping at the first hit:
 * the thread's own event (no name given) → the name in upcoming and recent events →
 * every word of it, in any order → the same in older events → nothing, with what's coming up.
 */
async function events(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['query']);
  const detail = args['detail'] === 'full' ? 'full' : 'brief';
  if (args['mine'] === true) return myEvents(ctx, q);
  const g = ctx.guild.id;
  if (!q) {
    if (ctx.threadEventId) {
      const e = await prisma.event.findFirst({
        where: { id: ctx.threadEventId, ...visibleTo(g) },
        include: eventInclude(g),
      });
      if (e)
        return ['Matched: the event of the thread this was asked in.', ...describeEvent(ctx, e, detail)].join('\n');
    }
    return upcomingEvents(ctx);
  }
  const now = Date.now();
  const words = q
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
  const byName: Prisma.EventWhereInput = { name: { contains: q, mode: 'insensitive' } };
  const byWords: Prisma.EventWhereInput | null =
    words.length > 1 ? { AND: words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })) } : null;
  const recent = { gte: new Date(now - RECENT_DAYS * DAY) };
  const older = { gte: new Date(now - OLDER_DAYS * DAY), lt: new Date(now - RECENT_DAYS * DAY) };
  const tiers: { where: Prisma.EventWhereInput; note?: string; newestFirst?: boolean }[] = [
    { where: { ...byName, startTime: recent } },
    ...(byWords ? [{ where: { ...byWords, startTime: recent } }] : []),
    {
      where: { OR: byWords ? [byName, byWords] : [byName], startTime: older },
      note: `Matched: an older event (nothing upcoming or in the last ${RECENT_DAYS} days has that name).`,
      newestFirst: true,
    },
  ];
  for (const tier of tiers) {
    const matches = await prisma.event.findMany({
      where: { AND: [tier.where, { status: { not: 'CANCELLED' } }, visibleTo(g)] },
      orderBy: { startTime: tier.newestFirst ? 'desc' : 'asc' },
      take: 5,
      include: eventInclude(g),
    });
    if (!matches.length) continue;
    // An exact name first; else the next one still to come, else the most recent.
    const e =
      matches.find((m) => m.name.toLowerCase() === q.toLowerCase()) ??
      (tier.newestFirst ? matches[0] : matches.find((m) => m.startTime.getTime() >= now - 6 * 3_600_000)) ??
      matches[matches.length - 1]!;
    const lines = [...(tier.note ? [tier.note] : []), ...describeEvent(ctx, e, detail)];
    const others = matches.filter((m) => m.id !== e.id);
    if (others.length)
      lines.push(
        `Other matches (ask which one if unsure): ${others
          .slice(0, 3)
          .map((m) => `${m.name} (${ts(m.startTime, 'd')})`)
          .join('; ')}`,
      );
    return lines.join('\n');
  }
  const next = await prisma.event.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      startTime: { gte: new Date(now - 6 * 3_600_000) },
      ...visibleTo(g),
    },
    orderBy: { startTime: 'asc' },
    take: 3,
    select: { name: true },
  });
  return `No event matching "${q}" in the last ${OLDER_DAYS} days or coming up.${next.length ? ` Coming up: ${next.map((e) => e.name).join('; ')}.` : ''}`;
}

async function myEvents(ctx: ToolContext, name = ''): Promise<string> {
  const g = ctx.guild.id;
  const rsvps = await prisma.eventRsvp.findMany({
    where: {
      userId: ctx.userId,
      event: {
        ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
        status: { in: ['PENDING', 'ACTIVE'] },
        startTime: { gte: new Date(Date.now() - 6 * 3_600_000) },
        ...visibleTo(g),
      },
    },
    include: { event: { select: { name: true, startTime: true, roles: true } } },
    orderBy: { event: { startTime: 'asc' } },
    take: 10,
  });
  const waits = await prisma.eventWaitlist.findMany({
    where: {
      userId: ctx.userId,
      event: {
        ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
        status: { in: ['PENDING', 'ACTIVE'] },
        ...visibleTo(g),
      },
    },
    include: { event: { select: { name: true } } },
  });
  if (!rsvps.length && !waits.length)
    return `They aren't signed up for any upcoming event${name ? ` matching "${name}"` : ''}.`;
  const lines = rsvps.map((r) => {
    const role = parseRoles(r.event.roles).find((x) => x.id === r.role)?.name;
    return `- ${r.event.name}: ${ts(r.event.startTime)}, ${r.tentative ? 'maybe' : role ? `as ${role}` : 'no role'}`;
  });
  for (const w of waits) lines.push(`- Waitlisted for ${w.event.name}`);
  return lines.join('\n');
}

async function myDkp(ctx: ToolContext): Promise<string> {
  const g = ctx.guild.id;
  if (!(await moduleOn(g, 'dkpEnabled'))) return 'DKP is switched off in this server.';
  const label = await getGuildDkpLabel(g);
  const [bal, all, tx] = await Promise.all([
    prisma.dkpBalance.findUnique({ where: { guildId_userId: { guildId: g, userId: ctx.userId } } }),
    prisma.dkpBalance.findMany({ where: { guildId: g }, orderBy: { balance: 'desc' }, select: { userId: true } }),
    prisma.dkpTransaction.findMany({
      where: { guildId: g, userId: ctx.userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ]);
  const rank = all.findIndex((b) => b.userId === ctx.userId) + 1;
  const lines = [
    `${label} balance: ${(bal?.balance ?? 0).toLocaleString('en-US')}${rank ? `, rank ${rank} of ${all.length}` : ''}`,
  ];
  for (const t of tx)
    lines.push(`${t.amount >= 0 ? '+' : ''}${t.amount} ${t.reason.slice(0, 80)} (${ts(t.createdAt, 'd')})`);
  lines.push(`Full history: ${web()}/dashboard/servers/${g}/dkp`);
  return lines.join('\n');
}

async function whoHasShip(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const g = ctx.guild.id;
  if (!(await moduleOn(g, 'fleetEnabled'))) return 'The Fleet module is switched off in this server.';
  const ship = searchShips(str(args['ship']), await shipList(), 1)[0];
  if (!ship || !str(args['ship'])) return `No ship called "${str(args['ship'])}".`;
  const eventName = str(args['event']);
  let people: Map<string, string> | null = null;
  let eventLabel = '';
  if (eventName) {
    const ev = await prisma.event.findFirst({
      where: {
        name: { contains: eventName, mode: 'insensitive' },
        status: { in: ['PENDING', 'ACTIVE'] },
        ...visibleTo(g),
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        name: true,
        guildId: true,
        rsvps: { select: { userId: true, username: true, guildId: true, tentative: true } },
      },
    });
    if (!ev) return `No upcoming event matching "${eventName}".`;
    const owners = await prisma.fleetOwner.findMany({
      where: { discordId: { in: ev.rsvps.map((r) => r.userId) } },
      select: { discordId: true, hiddenGuildIds: true },
    });
    people = eventFleetPeople(ev, ev.rsvps, owners);
    eventLabel = ` signed up for ${ev.name}`;
  }
  const rows = await prisma.fleetShip.findMany({
    where: { shipId: ship.id, available: true, ...(people ? { discordId: { in: [...people.keys()] } } : {}) },
    include: { owner: true },
  });
  const names = new Map<string, string>();
  if (people) for (const r of rows) names.set(r.discordId, people.get(r.discordId) ?? r.owner.username);
  else {
    const visible = rows.filter((r) => !(JSON.parse(r.owner.hiddenGuildIds) as string[]).includes(g));
    const ids = [...new Set(visible.map((r) => r.discordId))];
    const members = ids.length ? await ctx.guild.members.fetch({ user: ids }).catch(() => null) : null;
    for (const r of visible) {
      const m = members?.get(r.discordId);
      if (m) names.set(r.discordId, m.displayName);
    }
  }
  const count = new Map<string, number>();
  for (const r of rows) if (names.has(r.discordId)) count.set(r.discordId, (count.get(r.discordId) ?? 0) + r.quantity);
  const link = `${web()}/dashboard/servers/${g}/fleet`;
  if (!count.size) return `Nobody${eventLabel || ' in this server'} has a ${ship.name} in their fleet. Fleets: ${link}`;
  const list = [...count].map(([id, n]) => `${names.get(id)}${n > 1 ? ` ×${n}` : ''}`).sort();
  return `${ship.name} (${ship.manufacturer}) owned by ${list.length} member${list.length === 1 ? '' : 's'}${eventLabel}: ${list.slice(0, 25).join(', ')}${list.length > 25 ? '…' : ''}\nFleets: ${link}`;
}

function describeShip(ship: ShipCatalogEntry): string {
  const parts = [`${ship.name} by ${ship.manufacturer}`];
  if (ship.focus || ship.type) parts.push(`role: ${[ship.type, ship.focus].filter(Boolean).join(', ')}`);
  if (ship.size) parts.push(`size: ${ship.size}`);
  if (ship.maxCrew)
    parts.push(`crew: ${ship.minCrew && ship.minCrew !== ship.maxCrew ? `${ship.minCrew}–` : ''}${ship.maxCrew}`);
  if (ship.cargo !== null && ship.cargo !== undefined) parts.push(`cargo: ${ship.cargo} SCU`);
  if (ship.status) parts.push(`status: ${ship.status}`);
  return `${parts.join('; ')}.\nLoadouts, weapons and stats: ${web()}/tools`;
}

// The ore finder's data, from the API's public mining endpoint (built per game build); cached an hour.
let mining: { at: number; data: MiningDataDto } | null = null;
async function miningData(): Promise<MiningDataDto | null> {
  if (mining && Date.now() - mining.at < 3_600_000) return mining.data;
  const api = process.env['API_URL'] ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${api}/api/game-tools/mining`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return mining?.data ?? null;
    const body = (await res.json()) as { data?: MiningDataDto };
    if (body.data) mining = { at: Date.now(), data: body.data };
  } catch (err) {
    console.warn('[assistant] mining data:', err instanceof Error ? err.message : err);
  }
  return mining?.data ?? null;
}

type Ore = MiningDataDto['ores'][number];
function findOre(data: MiningDataDto | null, q: string): { ore: Ore; match: GameMatch } | null {
  if (!data) return null;
  const exact = data.ores.find((o) => o.key === q || o.name.toLowerCase() === q);
  if (exact) return { ore: exact, match: 'exact' };
  const partial = data.ores.find((o) => o.name.toLowerCase().includes(q) || q.includes(o.key));
  return partial ? { ore: partial, match: 'partial' } : null;
}

function describeOre(data: MiningDataDto, ore: Ore): string {
  const spots = data.spots.filter((s) => s.ore === ore.key).sort((a, b) => b.chance - a.chance);
  if (!spots.length) return `${ore.name} isn't the main ore of any rock in the game files.`;
  const how = { ship: 'ship mining', roc: 'ROC', hand: 'hand mining' } as Record<string, string>;
  const lines = spots
    .slice(0, 8)
    .map(
      (s) =>
        `- ${s.place} (${s.system}): ${s.rock}, ${Math.round(s.chance * 100)}% of ${how[s.method] ?? s.method} rocks there`,
    );
  return `${ore.name}, best places first (main ore only; game build ${data.build ?? 'current'}):\n${lines.join('\n')}${spots.length > 8 ? `\n…${spots.length - 8} more places` : ''}\nOre finder: ${web()}/tools/mining?ore=${encodeURIComponent(ore.key)}`;
}

type Blueprint = ReturnType<typeof getBlueprints>[number];
function findBlueprints(q: string): { hits: Blueprint[]; match: GameMatch } {
  const words = q.split(/\s+/).filter(Boolean);
  const hits = getBlueprints().filter((b) => {
    const name = b.outputName.toLowerCase();
    return words.every((w) => name.includes(w));
  });
  const exact = hits.findIndex((b) => b.outputName.toLowerCase() === q);
  if (exact > 0) hits.unshift(...hits.splice(exact, 1));
  return { hits, match: exact >= 0 ? 'exact' : hits.length ? 'partial' : null };
}

function describeBlueprint(hits: Blueprint[]): string {
  const bp = hits[0]!;
  const mats = bp.materials
    .map((m) => `${m.name}${m.quantityScu ? ` ${m.quantityScu} SCU` : m.quantity ? ` ×${m.quantity}` : ''}`)
    .join(', ');
  const contracts = getContractsForBlueprint(bp.uuid);
  const lines = [
    `${bp.outputName} (${bp.outputType}${bp.outputGrade ? `, grade ${bp.outputGrade}` : ''})`,
    `Needs: ${mats || 'nothing listed'}`,
  ];
  if (!contracts.length) lines.push('No missions reward it in the game files.');
  else {
    lines.push(`Missions that can reward it (${contracts.length}):`);
    for (const c of contracts.slice(0, 6))
      lines.push(
        `- ${c.title}${c.missionGiver ? `, from ${c.missionGiver}` : ''}${c.faction ? ` (${c.faction})` : ''}${c.illegal ? ', illegal' : ''}`,
      );
  }
  if (hits.length > 1)
    lines.push(
      `Other blueprints matching: ${hits
        .slice(1, 5)
        .map((b) => b.outputName)
        .join(', ')}`,
    );
  lines.push(`Details: ${web()}/tools/blueprints/${bp.uuid}`, gameDataFooter());
  return lines.join('\n');
}

const GAME_KINDS: readonly GameKind[] = ['ship', 'ore', 'blueprint'];

/**
 * The game lookup (v1.65.0): one name, checked against ores, ships and blueprints at once
 * (`rankGameKinds` picks the best), and the other kinds it also matches are named so the
 * model can ask for them with `kind`.
 */
async function game(_ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const raw = str(args['name']);
  const q = raw.toLowerCase();
  if (!q) return 'Name the ship, ore or blueprint.';
  const kind = GAME_KINDS.find((k) => k === args['kind']);
  const [ships, data] = await Promise.all([shipList(), miningData()]);
  const ship = searchShips(raw, ships, 1)[0];
  const ore = findOre(data, q);
  const bps = findBlueprints(q);
  const order = rankGameKinds(
    {
      ship: ship ? (ship.name.toLowerCase() === q ? 'exact' : 'partial') : null,
      ore: ore?.match ?? null,
      blueprint: bps.match,
    },
    kind,
  );
  if (!order.length) {
    const missing = [!data && 'mining data', !getBlueprints().length && 'blueprints'].filter(Boolean);
    return `Nothing called "${raw}" among ships, ores or blueprints in the game files.${missing.length ? ` (Not loaded right now: ${missing.join(', ')}.)` : ''}`;
  }
  const label = (k: GameKind) =>
    k === 'ship'
      ? `ship "${ship!.name}"`
      : k === 'ore'
        ? `ore "${ore!.ore.name}"`
        : `blueprint "${bps.hits[0]!.outputName}"`;
  const top = order[0]!;
  const body =
    top === 'ship' ? describeShip(ship!) : top === 'ore' ? describeOre(data!, ore!.ore) : describeBlueprint(bps.hits);
  const also = order.slice(1).map(label);
  return also.length
    ? `${body}\nThe name also matches ${also.join(' and ')} (ask with that kind if they meant it).`
    : body;
}

export const TOOL_RUNNERS: Record<string, (ctx: ToolContext, args: Record<string, unknown>) => Promise<string>> = {
  events,
  my_dkp: (ctx) => myDkp(ctx),
  who_has_ship: whoHasShip,
  game,
};

/** Runs one tool; failures become a short line for the model (and are logged). */
export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
  const run = TOOL_RUNNERS[name];
  if (!run) return `There is no tool called ${name}.`;
  try {
    return cap(await run(ctx, args));
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err);
    return 'That lookup failed.';
  }
}
