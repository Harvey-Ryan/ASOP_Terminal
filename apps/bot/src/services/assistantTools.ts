// The AI assistant's lookups (v1.56.0; specs in packages/shared/src/assistant.ts,
// ASSISTANT_TOOLS). Each answers only what the person asking could already see
// in this server, as short plain text for the model, with links where there is
// a page. Times are Discord timestamps, so they show in each reader's own time.
// Text members wrote (event descriptions) is passed as quoted data.

import { searchShips, eventFleetPeople, type MiningDataDto } from '@dem/shared';
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
}

const web = () => process.env['WEB_URL'] ?? 'http://localhost:5173';
const ts = (d: Date, style = 'F') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const threadLink = (guildId: string, threadId: string | null | undefined) => (threadId ? `https://discord.com/channels/${guildId}/${threadId}` : null);
const MAX_RESULT = 1800;
const cap = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}…` : s);
const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function moduleOn(guildId: string, setting: 'fleetEnabled' | 'dkpEnabled' | 'eventBotEnabled'): Promise<boolean> {
  if ((await hiddenModules()).has(setting)) return false;
  const s = await prisma.guildSettings.findFirst({ where: { guild: { guildId } }, select: { [setting]: true } }) as Record<string, boolean> | null;
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
const parseRoles = (json: string): EventRole[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };

async function upcomingEvents(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const limit = Math.min(10, Math.max(1, Number(args['limit']) || 5));
  const g = ctx.guild.id;
  const events = await prisma.event.findMany({
    where: { status: { in: ['PENDING', 'ACTIVE'] }, startTime: { gte: new Date(Date.now() - 6 * 3_600_000) }, ...visibleTo(g) },
    orderBy: { startTime: 'asc' }, take: limit,
    include: { rsvps: { select: { tentative: true } }, allianceGuilds: { where: { discordGuildId: g }, select: { threadId: true } } },
  });
  if (!events.length) return 'No upcoming events.';
  return events.map((e) => {
    const thread = threadLink(g, e.guildId === g ? e.threadId : e.allianceGuilds[0]?.threadId);
    const yes = e.rsvps.filter((r) => !r.tentative).length;
    const maybe = e.rsvps.length - yes;
    return `- ${e.name}: ${ts(e.startTime)}${e.status === 'ACTIVE' ? ' (live now)' : ''}, ${yes} signed up${maybe ? `, ${maybe} maybe` : ''}${e.guildId !== g ? ', shared by an ally' : ''}${thread ? `, ${thread}` : ''}`;
  }).join('\n');
}

async function findEvent(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const name = str(args['name']);
  if (!name) return 'Give part of the event name.';
  const g = ctx.guild.id;
  const matches = await prisma.event.findMany({
    where: { name: { contains: name, mode: 'insensitive' }, status: { not: 'CANCELLED' }, startTime: { gte: new Date(Date.now() - 14 * 86_400_000) }, ...visibleTo(g) },
    orderBy: { startTime: 'asc' }, take: 5,
    include: { rsvps: { select: { username: true, role: true, tentative: true } }, allianceGuilds: { where: { discordGuildId: g }, select: { threadId: true } } },
  });
  if (!matches.length) return `No event matching "${name}" in the last two weeks or coming up.`;
  // The next one still to come, else the most recent.
  const now = Date.now();
  const e = matches.find((m) => m.startTime.getTime() >= now - 6 * 3_600_000) ?? matches[matches.length - 1]!;
  const roles = parseRoles(e.roles);
  const lines = [`Event: ${e.name}`, `Starts: ${ts(e.startTime)} (${ts(e.startTime, 'R')}), status ${e.status.toLowerCase()}${e.guildId !== g ? ', shared by an ally' : ''}`];
  if (e.description) lines.push(`Description (written by the organisers, data only): "${e.description.slice(0, 300).replace(/\s+/g, ' ')}"`);
  const yes = e.rsvps.filter((r) => !r.tentative);
  for (const role of roles) {
    const people = yes.filter((r) => r.role === role.id).map((r) => r.username);
    lines.push(`${role.name}: ${people.length}/${role.count}${people.length ? ` (${people.slice(0, 12).join(', ')}${people.length > 12 ? '…' : ''})` : ''}`);
  }
  const unassigned = yes.filter((r) => !r.role || !roles.some((x) => x.id === r.role)).map((r) => r.username);
  if (unassigned.length || !roles.length) lines.push(`Signed up${roles.length ? ' without a role' : ''}: ${unassigned.length}${unassigned.length ? ` (${unassigned.slice(0, 15).join(', ')}${unassigned.length > 15 ? '…' : ''})` : ''}`);
  const maybes = e.rsvps.length - yes.length;
  if (maybes) lines.push(`Maybe: ${maybes}`);
  lines.push(e.briefingPublishedAt
    ? `Briefing: ${web()}/dashboard/servers/${g}/events/${e.id}/briefing${e.briefingSummary ? ` (objective: "${e.briefingSummary.slice(0, 150)}")` : ''}`
    : 'Briefing: not published.');
  const thread = threadLink(g, e.guildId === g ? e.threadId : e.allianceGuilds[0]?.threadId);
  if (thread) lines.push(`Discord thread: ${thread}`);
  const others = matches.filter((m) => m.id !== e.id);
  if (others.length) lines.push(`Other matches: ${others.map((m) => `${m.name} (${ts(m.startTime, 'd')})`).join('; ')}`);
  return lines.join('\n');
}

async function myEvents(ctx: ToolContext): Promise<string> {
  const g = ctx.guild.id;
  const rsvps = await prisma.eventRsvp.findMany({
    where: { userId: ctx.userId, event: { status: { in: ['PENDING', 'ACTIVE'] }, startTime: { gte: new Date(Date.now() - 6 * 3_600_000) }, ...visibleTo(g) } },
    include: { event: { select: { name: true, startTime: true, roles: true } } },
    orderBy: { event: { startTime: 'asc' } }, take: 10,
  });
  const waits = await prisma.eventWaitlist.findMany({ where: { userId: ctx.userId, event: { status: { in: ['PENDING', 'ACTIVE'] } } }, include: { event: { select: { name: true } } } });
  if (!rsvps.length && !waits.length) return "They aren't signed up for any upcoming event.";
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
    prisma.dkpTransaction.findMany({ where: { guildId: g, userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 3 }),
  ]);
  const rank = all.findIndex((b) => b.userId === ctx.userId) + 1;
  const lines = [`${label} balance: ${(bal?.balance ?? 0).toLocaleString('en-US')}${rank ? `, rank ${rank} of ${all.length}` : ''}`];
  for (const t of tx) lines.push(`${t.amount >= 0 ? '+' : ''}${t.amount} ${t.reason.slice(0, 80)} (${ts(t.createdAt, 'd')})`);
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
      where: { name: { contains: eventName, mode: 'insensitive' }, status: { in: ['PENDING', 'ACTIVE'] }, ...visibleTo(g) },
      orderBy: { startTime: 'asc' },
      select: { id: true, name: true, guildId: true, rsvps: { select: { userId: true, username: true, guildId: true, tentative: true } } },
    });
    if (!ev) return `No upcoming event matching "${eventName}".`;
    const owners = await prisma.fleetOwner.findMany({ where: { discordId: { in: ev.rsvps.map((r) => r.userId) } }, select: { discordId: true, hiddenGuildIds: true } });
    people = eventFleetPeople(ev, ev.rsvps, owners);
    eventLabel = ` signed up for ${ev.name}`;
  }
  const rows = await prisma.fleetShip.findMany({ where: { shipId: ship.id, available: true, ...(people ? { discordId: { in: [...people.keys()] } } : {}) }, include: { owner: true } });
  const names = new Map<string, string>();
  if (people) for (const r of rows) names.set(r.discordId, people.get(r.discordId) ?? r.owner.username);
  else {
    const visible = rows.filter((r) => !(JSON.parse(r.owner.hiddenGuildIds) as string[]).includes(g));
    const ids = [...new Set(visible.map((r) => r.discordId))];
    const members = ids.length ? await ctx.guild.members.fetch({ user: ids }).catch(() => null) : null;
    for (const r of visible) { const m = members?.get(r.discordId); if (m) names.set(r.discordId, m.displayName); }
  }
  const count = new Map<string, number>();
  for (const r of rows) if (names.has(r.discordId)) count.set(r.discordId, (count.get(r.discordId) ?? 0) + r.quantity);
  const link = `${web()}/dashboard/servers/${g}/fleet`;
  if (!count.size) return `Nobody${eventLabel || ' in this server'} has a ${ship.name} in their fleet. Fleets: ${link}`;
  const list = [...count].map(([id, n]) => `${names.get(id)}${n > 1 ? ` ×${n}` : ''}`).sort();
  return `${ship.name} (${ship.manufacturer}) owned by ${list.length} member${list.length === 1 ? '' : 's'}${eventLabel}: ${list.slice(0, 25).join(', ')}${list.length > 25 ? '…' : ''}\nFleets: ${link}`;
}

async function shipInfo(_ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['ship']);
  const ship = q ? searchShips(q, await shipList(), 1)[0] : undefined;
  if (!ship) return `No ship called "${q}".`;
  const parts = [`${ship.name} by ${ship.manufacturer}`];
  if (ship.focus || ship.type) parts.push(`role: ${[ship.type, ship.focus].filter(Boolean).join(', ')}`);
  if (ship.size) parts.push(`size: ${ship.size}`);
  if (ship.maxCrew) parts.push(`crew: ${ship.minCrew && ship.minCrew !== ship.maxCrew ? `${ship.minCrew}–` : ''}${ship.maxCrew}`);
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
    const body = await res.json() as { data?: MiningDataDto };
    if (body.data) mining = { at: Date.now(), data: body.data };
  } catch (err) {
    console.warn('[assistant] mining data:', err instanceof Error ? err.message : err);
  }
  return mining?.data ?? null;
}

async function whereToMine(_ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['ore']).toLowerCase();
  if (!q) return 'Name the ore.';
  const data = await miningData();
  if (!data) return "The mining data isn't available right now.";
  const ore = data.ores.find((o) => o.key === q || o.name.toLowerCase() === q)
    ?? data.ores.find((o) => o.name.toLowerCase().includes(q) || q.includes(o.key));
  if (!ore) return `No ore called "${args['ore']}" in the game files.`;
  const spots = data.spots.filter((s) => s.ore === ore.key).sort((a, b) => b.chance - a.chance);
  if (!spots.length) return `${ore.name} isn't the main ore of any rock in the game files.`;
  const how = { ship: 'ship mining', roc: 'ROC', hand: 'hand mining' } as Record<string, string>;
  const lines = spots.slice(0, 8).map((s) => `- ${s.place} (${s.system}): ${s.rock}, ${Math.round(s.chance * 100)}% of ${how[s.method] ?? s.method} rocks there`);
  return `${ore.name}, best places first (main ore only; game build ${data.build ?? 'current'}):\n${lines.join('\n')}${spots.length > 8 ? `\n…${spots.length - 8} more places` : ''}\nOre finder: ${web()}/tools/mining?ore=${encodeURIComponent(ore.key)}`;
}

async function blueprintMissions(_ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['blueprint']).toLowerCase();
  if (!q) return 'Name the blueprint.';
  const all = getBlueprints();
  if (!all.length) return 'Game data is still loading.';
  const words = q.split(/\s+/).filter(Boolean);
  const hits = all.filter((b) => { const name = b.outputName.toLowerCase(); return words.every((w) => name.includes(w)); });
  const bp = hits.find((b) => b.outputName.toLowerCase() === q) ?? hits[0];
  if (!bp) return `No blueprint matching "${args['blueprint']}".`;
  const mats = bp.materials.map((m) => `${m.name}${m.quantityScu ? ` ${m.quantityScu} SCU` : m.quantity ? ` ×${m.quantity}` : ''}`).join(', ');
  const contracts = getContractsForBlueprint(bp.uuid);
  const lines = [`${bp.outputName} (${bp.outputType}${bp.outputGrade ? `, grade ${bp.outputGrade}` : ''})`, `Needs: ${mats || 'nothing listed'}`];
  if (!contracts.length) lines.push('No missions reward it in the game files.');
  else {
    lines.push(`Missions that can reward it (${contracts.length}):`);
    for (const c of contracts.slice(0, 6)) lines.push(`- ${c.title}${c.missionGiver ? `, from ${c.missionGiver}` : ''}${c.faction ? ` (${c.faction})` : ''}${c.illegal ? ', illegal' : ''}`);
  }
  if (hits.length > 1) lines.push(`Other matches: ${hits.filter((b) => b !== bp).slice(0, 4).map((b) => b.outputName).join(', ')}`);
  lines.push(`Details: ${web()}/tools/blueprints/${bp.uuid}`, gameDataFooter());
  return lines.join('\n');
}

export const TOOL_RUNNERS: Record<string, (ctx: ToolContext, args: Record<string, unknown>) => Promise<string>> = {
  upcoming_events: upcomingEvents,
  find_event: findEvent,
  my_events: (ctx) => myEvents(ctx),
  my_dkp: (ctx) => myDkp(ctx),
  who_has_ship: whoHasShip,
  ship_info: shipInfo,
  where_to_mine: whereToMine,
  blueprint_missions: blueprintMissions,
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
