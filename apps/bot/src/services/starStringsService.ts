// StarStrings (v1.35.0): watches the LIVE build on GitHub and announces each
// new one in every server that chose a StarStrings channel; /starstrings
// shows the current one. Rules and parsing: packages/shared/src/starStrings.ts.
//
// GitHub is asked at most every STARSTRINGS_CHECK_MS, with the last ETag, so
// an unchanged release costs nothing against GitHub's rate limit.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  type MessageCreateOptions,
} from 'discord.js';
import {
  fileSize, parseStarStringsRelease, starStringsKey, starStringsPostedValue,
  STARSTRINGS_CHECK_MS, STARSTRINGS_INSTALL, STARSTRINGS_LIVE_API, STARSTRINGS_PAGE, type StarStringsRelease,
} from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { APP_VERSION } from '../appVersion.js';

let current: StarStringsRelease | null = null;
let etag: string | null = null;
let checkedAt = 0;
let asking: Promise<StarStringsRelease | null> | null = null;

/** For tests. */

async function ask(): Promise<StarStringsRelease | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `ASOP-Terminal/${APP_VERSION}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (etag && current) headers['If-None-Match'] = etag;
  const token = process.env['GITHUB_TOKEN'];
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(STARSTRINGS_LIVE_API, { headers, signal: AbortSignal.timeout(15_000) });
    checkedAt = Date.now();
    if (res.status === 304) return current;
    if (!res.ok) {
      console.warn(`[starstrings] GitHub answered ${res.status}; keeping the last build we saw`);
      return current;
    }
    const release = parseStarStringsRelease(await res.json());
    if (!release) {
      console.warn('[starstrings] GitHub\'s release had no usable build; keeping the last one');
      return current;
    }
    etag = res.headers.get('etag');
    current = release;
    return current;
  } catch (err) {
    checkedAt = Date.now(); // don't hammer GitHub while it's unreachable
    console.warn('[starstrings] Could not reach GitHub:', err instanceof Error ? err.message : err);
    return current;
  }
}

/** The current LIVE build (asking GitHub if our copy is older than maxAgeMs). */
export async function liveRelease(maxAgeMs = STARSTRINGS_CHECK_MS): Promise<StarStringsRelease | null> {
  if (current && Date.now() - checkedAt < maxAgeMs) return current;
  if (!asking) asking = ask().finally(() => { asking = null; });
  return asking;
}

/** The message for an announcement (new = a new build came out) or for /starstrings. */
export function starStringsMessage(r: StarStringsRelease, kind: 'new' | 'current'): MessageCreateOptions {
  const when = Math.floor(Date.parse(r.publishedAt) / 1000);
  const size = fileSize(r.sizeBytes);
  const embed = new EmbedBuilder()
    .setColor(0x3ba55d)
    .setTitle(kind === 'new' ? 'StarStrings updated for LIVE' : 'StarStrings: current LIVE build')
    .setURL(r.pageUrl)
    .setDescription([
      `**${r.build ?? r.name}**, published <t:${when}:f> (<t:${when}:R>)`,
      '',
      ...STARSTRINGS_INSTALL.map((l) => `• ${l}`),
    ].join('\n'))
    .setFooter({ text: 'StarStrings by MrKraken · community-made, not from CIG' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(r.downloadUrl)
      .setLabel(r.fileName ? `Download ${r.fileName}${size ? ` (${size})` : ''}`.slice(0, 80) : 'Download'),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(r.pageUrl).setLabel('Release notes'),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(STARSTRINGS_PAGE).setLabel('About StarStrings'),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** Problems already logged, so a channel the bot can't use isn't reported every half hour. */
const reported = new Set<string>();
/** The posting loop runs every minute; a full pass happens on a new build or every check interval. */
let lastPass = { key: '', at: 0 };

/**
 * Posts the current build in every StarStrings channel that hasn't had it
 * (posting loop; GitHub is only asked when our copy is old). `now`: a channel
 * was just chosen, so check the servers straight away with the build we know.
 */
export async function announceStarStrings(now = false): Promise<void> {
  const release = await liveRelease(now ? Infinity : STARSTRINGS_CHECK_MS);
  if (!release) return;
  const key = starStringsKey(release);
  if (!now && lastPass.key === key && Date.now() - lastPass.at < STARSTRINGS_CHECK_MS) return;
  lastPass = { key, at: Date.now() };
  const rows = await prisma.guildSettings.findMany({
    where: { starStringsChannelId: { not: null } },
    select: { id: true, starStringsChannelId: true, starStringsPosted: true, guild: { select: { guildId: true } } },
  });
  for (const s of rows) {
    const channelId = s.starStringsChannelId!;
    const posted = starStringsPostedValue(channelId, key);
    if (s.starStringsPosted === posted || !client.guilds.cache.has(s.guild.guildId)) continue;
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch || !ch.isTextBased() || !('send' in ch)) throw new Error('the channel is gone or isn\'t a text channel');
      const msg = await ch.send(starStringsMessage(release, 'new'));
      // In an announcement channel, publish it to servers that follow the channel too (best effort).
      if (ch.type === ChannelType.GuildAnnouncement) await msg.crosspost().catch(() => {});
      await prisma.guildSettings.update({ where: { id: s.id }, data: { starStringsPosted: posted } });
    } catch (err) {
      const k = `${s.guild.guildId}|${posted}`;
      if (!reported.has(k)) {
        reported.add(k);
        console.warn(`[starstrings] Couldn't post ${release.build ?? release.name} in server ${s.guild.guildId}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}
