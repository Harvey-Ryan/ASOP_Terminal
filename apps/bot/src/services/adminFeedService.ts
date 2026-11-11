// The admin Discord feed (v1.13.0): the channel chosen in the admin panel
// (AdminConfig) gets
//   - servers adding or removing the bot, and feed tests, as they happen;
//   - an alert when a new kind of error appears, or a resolved one comes back
//     (at most one per kind every 6 hours, at most 5 per minute);
//   - a daily digest at the chosen local hour.
// Runs every minute (index.ts) and when the API asks (/trigger/admin-feed).
// Reads only the database; nothing is sent to Discord unless there's news.

import { EmbedBuilder, type SendableChannels } from 'discord.js';
import { client } from '../client.js';
import { prisma } from '../db.js';
import { RELEASE } from '../utils/errorLog.js';

const HOUR = 3_600_000;
const ALERT_EVERY_MS = 6 * HOUR;
const MAX_ALERTS_PER_TICK = 5;
const COLORS = { info: 0x5865f2, good: 0x2ecc71, warn: 0xf1c40f, bad: 0xe74c3c } as const;

const webUrl = () => (process.env['WEB_URL'] ?? '').replace(/\/$/, '');
const adminLink = (path: string) => (webUrl() ? `${webUrl()}/dashboard/admin${path}` : null);

let running = false;

/** One pass: log entries, error alerts, the digest. Never throws. */
export async function adminFeedTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cfg = await prisma.adminConfig.findUnique({ where: { id: 1 } });
    if (!cfg?.feedChannelId) return;
    const channel = await client.channels.fetch(cfg.feedChannelId).catch(() => null);
    if (!channel || !channel.isSendable()) {
      console.warn(`[adminFeed] Can't post in the admin feed channel ${cfg.feedChannelId} (missing, or no permission).`);
      return;
    }
    await postLogEntries(channel);
    if (cfg.alertsEnabled) await postAlerts(channel, cfg.alertCursor, now);
    if (cfg.digestEnabled) await maybePostDigest(channel, cfg, now);
  } catch (err) {
    console.error('[adminFeed] Tick failed:', err);
  } finally {
    running = false;
  }
}

// ── Servers joining / leaving, tests ────────────────────────────────────────

const POSTED_NOW = ['guild.joined', 'guild.left', 'admin.test'];

async function postLogEntries(channel: SendableChannels): Promise<void> {
  const entries = await prisma.adminLog.findMany({ where: { posted: false, kind: { in: POSTED_NOW } }, orderBy: { id: 'asc' }, take: 10 });
  for (const e of entries) {
    const embed = new EmbedBuilder().setTimestamp(e.createdAt);
    if (e.kind === 'guild.joined') embed.setColor(COLORS.good).setTitle('➕ Bot added to a server').setDescription(`**${e.guildName ?? e.guildId}**\n${e.summary}`);
    else if (e.kind === 'guild.left') embed.setColor(COLORS.warn).setTitle('➖ Bot removed from a server').setDescription(`**${e.guildName ?? e.guildId}**\n${e.summary}`);
    else embed.setColor(COLORS.info).setTitle('✅ Admin feed test').setDescription(`Sent by ${e.actorName ?? 'an admin'}. Alerts and the daily digest will be posted here.`);
    await channel.send({ embeds: [embed] });
    await prisma.adminLog.update({ where: { id: e.id }, data: { posted: true } });
  }
}

// ── Error alerts ────────────────────────────────────────────────────────────

async function postAlerts(channel: SendableChannels, cursor: number, now: Date): Promise<void> {
  const fresh = await prisma.errorEvent.findMany({
    where: { id: { gt: cursor }, level: 'error' },
    orderBy: { id: 'asc' },
    take: 1_000,
    select: { id: true, fingerprint: true, source: true, message: true, guildId: true, ref: true, createdAt: true },
  });
  if (fresh.length === 0) return;
  const newCursor = fresh[fresh.length - 1]!.id;

  const byKind = new Map<string, typeof fresh>();
  for (const e of fresh) byKind.set(e.fingerprint, [...(byKind.get(e.fingerprint) ?? []), e]);
  const fps = [...byKind.keys()];
  const [states, seenBefore] = await Promise.all([
    prisma.errorGroupState.findMany({ where: { fingerprint: { in: fps } } }),
    prisma.errorEvent.groupBy({ by: ['fingerprint'], where: { fingerprint: { in: fps }, id: { lte: cursor } }, _count: { _all: true } }),
  ]);
  const stateBy = new Map(states.map((s) => [s.fingerprint, s]));
  const known = new Set(seenBefore.map((s) => s.fingerprint));

  const worth: { fp: string; reason: 'new' | 'back'; events: typeof fresh }[] = [];
  for (const [fp, events] of byKind) {
    const st = stateBy.get(fp);
    if (st?.status === 'ignored') continue;
    if (st?.alertedAt && now.getTime() - st.alertedAt.getTime() < ALERT_EVERY_MS) continue;
    if (!known.has(fp)) worth.push({ fp, reason: 'new', events });
    else if (st?.status === 'resolved' && st.resolvedAt && events.some((e) => e.createdAt > st.resolvedAt!)) worth.push({ fp, reason: 'back', events });
  }

  const shown = worth.slice(0, MAX_ALERTS_PER_TICK);
  if (shown.length > 0) {
    const guildIds = [...new Set(shown.flatMap((w) => w.events.map((e) => e.guildId)).filter((g): g is string => !!g))];
    const guilds = new Map((await prisma.guild.findMany({ where: { guildId: { in: guildIds } }, select: { guildId: true, name: true } })).map((g) => [g.guildId, g.name]));
    const embeds = shown.map(({ reason, events }) => {
      const e = events[events.length - 1]!;
      const servers = [...new Set(events.map((x) => x.guildId).filter((g): g is string => !!g))].map((g) => guilds.get(g) ?? g);
      const link = adminLink(`/errors/${e.id}`);
      return new EmbedBuilder()
        .setColor(reason === 'new' ? COLORS.bad : COLORS.warn)
        .setTitle(`${reason === 'new' ? '🆕 New error' : '🔁 Resolved error is back'} · ${e.source}`)
        .setDescription(`\`\`\`${e.message.slice(0, 900).replace(/```/g, "'''")}\`\`\``)
        .addFields(
          { name: 'Times', value: String(events.length), inline: true },
          { name: 'Servers', value: servers.length ? servers.slice(0, 3).join(', ') + (servers.length > 3 ? ` +${servers.length - 3}` : '') : '—', inline: true },
          { name: 'Ref', value: e.ref ?? '—', inline: true },
        )
        .setTimestamp(e.createdAt)
        .setURL(link ?? null);
    });
    const more = worth.length - shown.length;
    await channel.send({ content: more > 0 ? `…and ${more} more new kind(s) of error. See the admin panel.` : undefined, embeds });
    await prisma.$transaction(shown.map(({ fp }) => prisma.errorGroupState.upsert({
      where: { fingerprint: fp }, create: { fingerprint: fp, alertedAt: now }, update: { alertedAt: now },
    })));
  }
  await prisma.adminConfig.update({ where: { id: 1 }, data: { alertCursor: newCursor } });
}

// ── Daily digest ────────────────────────────────────────────────────────────

/** Date ("2026-11-11") and hour in a time zone. */
export function localDateHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, hour: Number(parts['hour']) };
}

async function maybePostDigest(channel: SendableChannels, cfg: { digestHour: number; digestTimezone: string; lastDigestDate: string | null }, now: Date): Promise<void> {
  const { date, hour } = localDateHour(now, cfg.digestTimezone);
  if (hour !== cfg.digestHour || cfg.lastDigestDate === date) return;
  // Claim today's digest first, so a restart in the same hour doesn't post twice.
  await prisma.adminConfig.update({ where: { id: 1 }, data: { lastDigestDate: date } });
  await channel.send({ embeds: [await buildDigest(now)] });
}

export async function buildDigest(now: Date): Promise<EmbedBuilder> {
  const since = new Date(now.getTime() - 24 * HOUR);
  const [bySource, warnings, kinds, firstSeen, log, beats, guilds] = await Promise.all([
    prisma.errorEvent.groupBy({ by: ['source'], where: { level: 'error', createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.errorEvent.count({ where: { level: 'warn', createdAt: { gte: since } } }),
    prisma.errorEvent.groupBy({ by: ['fingerprint'], where: { level: 'error', createdAt: { gte: since } }, _count: { _all: true }, _max: { id: true }, orderBy: { _count: { fingerprint: 'desc' } }, take: 5 }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT fingerprint FROM "ErrorEvent" WHERE level = 'error' GROUP BY fingerprint HAVING min("createdAt") >= ${since}) k`,
    prisma.adminLog.findMany({ where: { createdAt: { gte: since }, kind: { in: ['guild.joined', 'guild.left', 'admin.settings'] } }, orderBy: { id: 'asc' } }),
    prisma.serviceHeartbeat.findMany(),
    prisma.guild.count(),
  ]);
  const total = bySource.reduce((a, r) => a + r._count._all, 0);
  const samples = await prisma.errorEvent.findMany({ where: { id: { in: kinds.map((k) => k._max.id!).filter(Boolean) } }, select: { id: true, fingerprint: true, message: true, source: true } });
  const sampleBy = new Map(samples.map((s) => [s.fingerprint, s]));
  const top = kinds.map((k) => {
    const s = sampleBy.get(k.fingerprint);
    return `**${k._count._all}×** \`${s?.source ?? '?'}\` ${(s?.message ?? '').slice(0, 90)}`;
  });
  const joined = log.filter((l) => l.kind === 'guild.joined').map((l) => l.guildName ?? l.guildId);
  const left = log.filter((l) => l.kind === 'guild.left').map((l) => l.guildName ?? l.guildId);
  const changes = log.filter((l) => l.kind === 'admin.settings');
  const svc = (name: string) => {
    const b = beats.find((x) => x.service === name);
    return b && now.getTime() - b.beatAt.getTime() < 3 * 60_000 ? `🟢 ${name} ${b.release}` : `🔴 ${name} not reporting`;
  };
  const link = adminLink('');
  return new EmbedBuilder()
    .setColor(total === 0 ? COLORS.good : COLORS.info)
    .setTitle('📋 ASOP daily digest')
    .setDescription([
      total === 0 ? 'No errors in the last 24 hours.' : `**${total}** error(s) in the last 24 hours (${bySource.map((r) => `${r.source} ${r._count._all}`).join(', ')}), ${warnings} warning(s).`,
      `New kinds of error: **${Number(firstSeen[0]?.n ?? 0)}**.`,
      link ? `[Open the admin panel](${link})` : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      ...(top.length ? [{ name: 'Most frequent', value: top.join('\n').slice(0, 1024) }] : []),
      { name: 'Servers', value: [`${guilds} in total`, joined.length ? `➕ ${joined.join(', ')}` : '', left.length ? `➖ ${left.join(', ')}` : ''].filter(Boolean).join('\n').slice(0, 1024) },
      ...(changes.length ? [{ name: 'Admin changes', value: changes.slice(-5).map((c) => `${c.guildName ?? ''}: ${c.summary}`).join('\n').slice(0, 1024) }] : []),
      { name: 'Services', value: `${svc('api')}\n${svc('bot')}` },
    )
    .setFooter({ text: `Bot ${RELEASE}` })
    .setTimestamp(now);
}
