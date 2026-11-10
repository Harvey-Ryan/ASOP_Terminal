// Keeps one live status embed per guild in the guild's configured status channel.
//
// Runs on the scheduler's 1-minute tick. Builds the embed once per tick and only
// touches Discord for a guild when the content changed, the message is gone
// (deleted by someone), or the channel setting moved.

import { DiscordAPIError, type APIEmbed } from 'discord.js';
import { GAME_DATA_STATUS_SQL, GAME_DATA_NOT_SET_UP, parseGameDataStatus, isGameDataMissingError, type GameDataStatus } from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { APP_VERSION, APP_COMMIT } from '../appVersion.js';
import { buildStatusEmbed, type StatusSnapshot } from '../utils/statusEmbed.js';

// ── Pure refresh logic (testable with fake Discord ops) ─────────────────────

export interface StatusTarget {
  settingsId: string;
  channelId: string | null;
  messageId: string | null;
  messageChannelId: string | null;
  hash: string | null;
}

export interface StatusOps {
  send(channelId: string, embed: APIEmbed): Promise<string>;
  /** 'missing' when the message no longer exists */
  edit(channelId: string, messageId: string, embed: APIEmbed): Promise<'ok' | 'missing'>;
  remove(channelId: string, messageId: string): Promise<void>;
}

export type TargetUpdate = Pick<StatusTarget, 'messageId' | 'messageChannelId' | 'hash'>;

/** Brings one guild's status message in line with `embed`. Returns the fields to save, or null if nothing changed. */
export async function refreshTarget(t: StatusTarget, embed: APIEmbed, hash: string, ops: StatusOps): Promise<TargetUpdate | null> {
  let messageId = t.messageId;
  let messageChannelId = t.messageChannelId;
  const before = JSON.stringify([t.messageId, t.messageChannelId, t.hash]);

  // Setting cleared or moved: take down the old message (best effort).
  if (messageId && messageChannelId && messageChannelId !== t.channelId) {
    await ops.remove(messageChannelId, messageId).catch(() => {});
    messageId = null;
    messageChannelId = null;
  }
  if (!t.channelId) {
    const after: TargetUpdate = { messageId: null, messageChannelId: null, hash: null };
    return JSON.stringify([after.messageId, after.messageChannelId, after.hash]) === before ? null : after;
  }

  if (messageId && t.hash === hash) return null; // up to date

  if (messageId) {
    const r = await ops.edit(t.channelId, messageId, embed);
    if (r === 'missing') messageId = null;
  }
  if (!messageId) {
    messageId = await ops.send(t.channelId, embed);
    messageChannelId = t.channelId;
  }
  return { messageId, messageChannelId, hash };
}

// ── Discord + database wiring ───────────────────────────────────────────────

const UNKNOWN_MESSAGE = 10008;
const lastWarn = new Map<string, number>();
function warnHourly(key: string, msg: string) {
  const now = Date.now();
  if (now - (lastWarn.get(key) ?? 0) < 60 * 60_000) return;
  lastWarn.set(key, now);
  console.warn(msg);
}

async function textChannel(channelId: string) {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased() || !('send' in ch)) throw new Error(`Channel ${channelId} is not a text channel`);
  return ch;
}

const discordOps: StatusOps = {
  async send(channelId, embed) {
    const ch = await textChannel(channelId);
    const msg = await ch.send({ embeds: [embed] });
    return msg.id;
  },
  async edit(channelId, messageId, embed) {
    const ch = await textChannel(channelId);
    try {
      const msg = await ch.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
      return 'ok';
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === UNKNOWN_MESSAGE) return 'missing';
      throw err;
    }
  },
  async remove(channelId, messageId) {
    const ch = await textChannel(channelId);
    await ch.messages.delete(messageId);
  },
};

let deployedAt: Date | null = null;

/** Records this version + commit the first time it runs, and remembers when that was. */
export async function recordDeployment(): Promise<void> {
  try {
    const row = await prisma.appDeployment.upsert({
      where: { version_commitSha: { version: APP_VERSION, commitSha: APP_COMMIT } },
      update: {},
      create: { version: APP_VERSION, commitSha: APP_COMMIT },
    });
    deployedAt = row.firstSeenAt;
    console.log(`[bot] ASOP v${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ''}, first deployed ${row.firstSeenAt.toISOString()}`);
  } catch (err) {
    console.error('[bot] Could not record deployment:', err);
  }
}

async function readGameData(): Promise<GameDataStatus> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ status: unknown }[]>(GAME_DATA_STATUS_SQL);
    return parseGameDataStatus(rows[0]?.status);
  } catch (err) {
    if (isGameDataMissingError(err)) return GAME_DATA_NOT_SET_UP;
    throw err;
  }
}

export async function refreshStatusEmbeds(): Promise<void> {
  const targets = await prisma.guildSettings.findMany({
    where: { OR: [{ statusChannelId: { not: null } }, { statusMessageId: { not: null } }] },
    select: { id: true, statusChannelId: true, statusMessageId: true, statusMessageChannelId: true, statusEmbedHash: true },
  });
  if (targets.length === 0) return;

  const snapshot: StatusSnapshot = {
    app: { version: APP_VERSION, commit: APP_COMMIT, deployedAt },
    gameData: await readGameData(),
    serverCount: client.guilds.cache.size,
    now: new Date(),
  };
  const { embed, hash } = buildStatusEmbed(snapshot);

  for (const s of targets) {
    const t: StatusTarget = {
      settingsId: s.id, channelId: s.statusChannelId, messageId: s.statusMessageId,
      messageChannelId: s.statusMessageChannelId, hash: s.statusEmbedHash,
    };
    try {
      const update = await refreshTarget(t, embed, hash, discordOps);
      if (update) {
        await prisma.guildSettings.update({
          where: { id: s.id },
          data: { statusMessageId: update.messageId, statusMessageChannelId: update.messageChannelId, statusEmbedHash: update.hash },
        });
      }
    } catch (err) {
      // Usually missing permissions or a deleted channel; try again next tick, log at most hourly.
      const reason = err instanceof DiscordAPIError ? `${err.code} ${err.message}` : (err as Error).message;
      warnHourly(s.id, `[bot] Status embed for settings ${s.id} in channel ${s.statusChannelId} failed: ${reason}`);
    }
  }
}
