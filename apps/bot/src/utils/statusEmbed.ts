// Builds the live "ASOP Terminal — System Status" embed. Pure: no Discord or
// database access, so it can be tested and previewed on its own.

import { createHash } from 'node:crypto';
import { EmbedBuilder, type APIEmbed } from 'discord.js';
import { GAME_DATA_CHECK_INTERVAL_MIN, type GameDataStatus } from '@dem/shared';

export interface StatusSnapshot {
  app: { version: string; commit: string; deployedAt: Date | null };
  gameData: GameDataStatus;
  serverCount: number;
  now: Date;
}

const COLOR = { ok: 0x2ecc71, syncing: 0x3498db, warn: 0xf1c40f, error: 0xe74c3c, idle: 0x747f8d } as const;
// The "last check" time moves every 5 minutes. While checks are on schedule the
// field says so in words (so it doesn't force an edit every 5 minutes); only a
// late check shows its actual time.
const LAST_CHECK_FRESH_MS = 15 * 60_000;

const ts = (iso: string | Date | null | undefined, style: 'R' | 'f' | 'F' | 'D' = 'R') => {
  if (!iso) return '—';
  const sec = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${sec}:${style}>`;
};
const num = (n: number) => n.toLocaleString('en-US');
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function lastCheck(iso: string | null, now: Date): string {
  if (!iso) return '—';
  if (now.getTime() - new Date(iso).getTime() < LAST_CHECK_FRESH_MS) {
    return `Within the last 15 min\nevery ${GAME_DATA_CHECK_INTERVAL_MIN} min`;
  }
  return `${ts(iso)}\nevery ${GAME_DATA_CHECK_INTERVAL_MIN} min`;
}

function headline(s: StatusSnapshot): { text: string; color: number } {
  const g = s.gameData;
  switch (g.health) {
    case 'syncing':
      return { text: `🔄 **Updating game data…** started ${ts(g.running?.startedAt)}`, color: COLOR.syncing };
    case 'failed':
      return { text: '⚠️ **Last game data update failed.** The previous data is still in use; it retries automatically every 30 minutes.', color: COLOR.error };
    case 'stale':
      return { text: `⚠️ **Game data checks have stopped** — last check ${ts(g.lastCheckAt)}. The data still works but may fall behind.`, color: COLOR.warn };
    case 'not_set_up':
      return { text: '⏳ **Game data is not set up yet.** It appears here after the first sync.', color: COLOR.idle };
    default:
      return { text: '✅ **All systems normal.** Game data is up to date.', color: COLOR.ok };
  }
}

/** Returns the embed and a hash of everything that should trigger an edit. */
export function buildStatusEmbed(s: StatusSnapshot): { embed: APIEmbed; hash: string } {
  const g = s.gameData;
  const { text, color } = headline(s);
  const lines = [text];
  if (g.pendingRequest) {
    lines.push(`🔁 Full re-sync requested${g.pendingRequest.requestedBy ? ` by **${g.pendingRequest.requestedBy}**` : ''} ${ts(g.pendingRequest.requestedAt)}; starts within ${GAME_DATA_CHECK_INTERVAL_MIN} minutes.`);
  }

  const version = `**v${s.app.version}**${s.app.commit ? ` · \`${s.app.commit}\`` : ''}`;
  const change = g.lastChange
    ? `+${num(g.lastChange.added)} new · ${num(g.lastChange.changed)} changed · ${num(g.lastChange.removed)} removed\n${ts(g.lastChange.finishedAt)}`
    : '—';
  const counts = g.counts
    ? [`${num(g.counts.items)} items`, `${num(g.counts.ships)} ships & vehicles`, `${num(g.counts.contracts)} missions`, `${num(g.counts.blueprints)} blueprints`, `${num(g.counts.commodities)} commodities`].join('\n')
    : '—';

  const fields: APIEmbed['fields'] = [
    { name: 'ASOP Version', value: version, inline: true },
    { name: 'Deployed', value: s.app.deployedAt ? `${ts(s.app.deployedAt, 'f')}\n${ts(s.app.deployedAt)}` : '—', inline: true },
    { name: 'Servers', value: num(s.serverCount), inline: true },

    { name: 'Game Data Build', value: g.build ? `\`${g.build}\`` : g.commit ? `\`${g.commit.slice(0, 12)}\`` : '—', inline: true },
    { name: 'scunpacked Published', value: g.committedAt ? `${ts(g.committedAt, 'f')}\n${ts(g.committedAt)}` : '—', inline: true },
    { name: 'Synced to ASOP', value: g.syncedAt ? `${ts(g.syncedAt, 'f')}\n${ts(g.syncedAt)}` : '—', inline: true },

    { name: 'Last Check', value: lastCheck(g.lastCheckAt, s.now), inline: true },
    { name: 'Last Update', value: change, inline: true },
    { name: 'Database', value: counts, inline: true },
  ];
  if (g.health === 'failed' && g.lastRun?.error) {
    fields.push({ name: 'Last Error', value: `\`\`\`${clip(g.lastRun.error.replace(/`/g, "'"), 300)}\`\`\`` });
  }

  const embed = new EmbedBuilder()
    .setTitle('🛰️ ASOP Terminal — System Status')
    .setDescription(lines.join('\n'))
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: 'Updates automatically · Game data from the Star Citizen Wiki (scunpacked-data)' })
    .toJSON();

  const hash = createHash('sha256').update(JSON.stringify(embed)).digest('hex').slice(0, 16);
  // The timestamp shows when the message was last edited; it's set after hashing
  // so it never causes an edit on its own.
  return { embed: { ...embed, timestamp: s.now.toISOString() }, hash };
}
