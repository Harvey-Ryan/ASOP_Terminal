// Ally notices in Discord (v1.10.0). The API tells the bot after every ally
// change (/trigger/ally); the bot posts a request with Accept / Reject / Reject
// and block buttons in the asked org's ally notice channel, edits it once the
// request is answered (on the website or here), and tells the other org about
// answers and endings. Orgs with no ally notice channel get no messages.
//
// Rules are shared with the API: packages/shared/src/allies.ts.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
} from 'discord.js';
import {
  allyButtonId,
  allyRefusalMessage,
  decideResponse,
  parseAllyButtonId,
  responseChanges,
  type AllyNoticeEvent,
  type AllyNoticePayload,
  type AllyResponse,
} from '@dem/shared';
import { prisma } from '../db.js';
import { client } from '../client.js';

// ── Discord access (injectable for tests) ────────────────────────────────────

export interface NoticeMessage {
  embeds: ReturnType<EmbedBuilder['toJSON']>[];
  components: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
}

export interface AllyDiscord {
  /** Posts a message; returns its id. */
  send(channelId: string, message: NoticeMessage): Promise<string>;
  edit(channelId: string, messageId: string, message: NoticeMessage): Promise<void>;
}

async function textChannel(channelId: string) {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased() || !('send' in ch)) throw new Error(`Channel ${channelId} is not a text channel`);
  return ch;
}

export const liveDiscord: AllyDiscord = {
  async send(channelId, message) {
    const ch = await textChannel(channelId);
    return (await ch.send(message)).id;
  },
  async edit(channelId, messageId, message) {
    const ch = await textChannel(channelId);
    await (await ch.messages.fetch(messageId)).edit(message);
  },
};

// ── Messages ─────────────────────────────────────────────────────────────────

export const COLOR = { request: 0x5865f2, good: 0x2ecc71, bad: 0xe74c3c, quiet: 0x747f8d } as const;

export interface OrgInfo {
  /** Discord snowflake. */
  guildId: string;
  name: string;
  tag: string | null;
  icon: string | null;
}

export const webUrl = () => process.env['WEB_URL'] ?? 'http://localhost:5173';
const alliesPage = (discordGuildId: string) => `${webUrl()}/dashboard/servers/${discordGuildId}/settings/allies`;
export const label = (o: OrgInfo) => (o.tag ? `${o.name} [${o.tag}]` : o.name);
export const iconUrl = (o: OrgInfo) => (o.icon ? `https://cdn.discordapp.com/icons/${o.guildId}/${o.icon}.png?size=128` : null);
const day = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:D>`;

/** The request as first posted in the asked org's channel, with its buttons. */
export function requestMessage(from: OrgInfo, to: OrgInfo, linkId: string, note: string | null): NoticeMessage {
  const embed = new EmbedBuilder()
    .setColor(COLOR.request)
    .setTitle(`🤝 Ally request from ${label(from)}`)
    .setDescription(`**${from.name}** would like to be allies with **${to.name}**. Allies can share events with each other.`)
    .setFooter({ text: 'Officers who manage allies can answer here or on the Allies page.' });
  const ic = iconUrl(from);
  if (ic) embed.setThumbnail(ic);
  if (note) embed.addFields({ name: 'Message', value: note.slice(0, 1024) });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(allyButtonId('accept', linkId)).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(allyButtonId('reject', linkId)).setLabel('Reject').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(allyButtonId('block', linkId)).setLabel('Reject and block').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setLabel('Allies page').setStyle(ButtonStyle.Link).setURL(alliesPage(to.guildId)),
  );
  return { embeds: [embed.toJSON()], components: [row.toJSON()] };
}

export type RequestOutcome = 'accepted' | 'rejected' | 'blocked' | 'cancelled';

/** The same request after it was answered or withdrawn: no buttons, says what happened and who did it. */
export function answeredMessage(from: OrgInfo, to: OrgInfo, note: string | null, outcome: RequestOutcome, actorUserId: string | null): NoticeMessage {
  const by = actorUserId ? ` by <@${actorUserId}>` : '';
  const text: Record<RequestOutcome, [string, number]> = {
    accepted: [`✅ Accepted${by}. ${from.name} and ${to.name} are now allies.`, COLOR.good],
    rejected: [`Rejected${by}. ${from.name} can ask again in 7 days.`, COLOR.bad],
    blocked: [`🚫 Rejected and blocked${by}. ${from.name} can't send more requests until it's unblocked on the Allies page.`, COLOR.bad],
    cancelled: [`Withdrawn by ${from.name}.`, COLOR.quiet],
  };
  const [line, color] = text[outcome];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🤝 Ally request from ${label(from)}`)
    .setDescription(line);
  const ic = iconUrl(from);
  if (ic) embed.setThumbnail(ic);
  if (note) embed.addFields({ name: 'Message', value: note.slice(0, 1024) });
  return { embeds: [embed.toJSON()], components: [] };
}

/** A one-off notice for the other org: an answer to its request, or an alliance ending. */
export function infoMessage(kind: 'accepted' | 'rejected' | 'removed', actor: OrgInfo, other: OrgInfo, retryAfter: Date | null): NoticeMessage {
  const content: Record<typeof kind, [string, string, number]> = {
    accepted: ['🤝 Ally request accepted', `**${actor.name}** accepted your ally request. ${other.name} and ${actor.name} are now allies.`, COLOR.good],
    rejected: ['Ally request declined', `**${actor.name}** declined your ally request.${retryAfter ? ` You can ask again from ${day(retryAfter)}.` : ''}`, COLOR.bad],
    removed: ['Alliance ended', `**${actor.name}** is no longer allied with ${other.name}.`, COLOR.quiet],
  };
  const [title, desc, color] = content[kind];
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
  const ic = iconUrl(actor);
  if (ic) embed.setThumbnail(ic);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Allies page').setStyle(ButtonStyle.Link).setURL(alliesPage(other.guildId)),
  );
  return { embeds: [embed.toJSON()], components: [row.toJSON()] };
}

// ── Handling a notice from the API ───────────────────────────────────────────

export async function loadOrg(internalId: string): Promise<(OrgInfo & { noticeChannelId: string | null }) | null> {
  const g = await prisma.guild.findUnique({ where: { id: internalId }, include: { settings: true } });
  if (!g) return null;
  return { guildId: g.guildId, name: g.name, icon: g.icon, tag: g.settings?.allianceTag ?? null, noticeChannelId: g.settings?.allyNoticeChannelId ?? null };
}

/** Logs and swallows a Discord failure (missing channel, missing permission…): notices are best-effort. */
export async function tryDiscord<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[allies] Could not ${what}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Posts or updates the Discord messages for one ally change. Every Discord call
 * is best-effort: a missing channel or permission is logged and skipped.
 */
export async function handleAllyNotice(p: AllyNoticePayload, discord: AllyDiscord = liveDiscord): Promise<void> {
  const [actor, other] = await Promise.all([loadOrg(p.actorGuildId), loadOrg(p.otherGuildId)]);
  if (!actor || !other) return;
  const link = await prisma.guildAlly.findUnique({ where: { id: p.linkId } });

  switch (p.event as AllyNoticeEvent) {
    case 'requested': {
      // Post only while the request is still waiting, and only once.
      if (!link || link.status !== 'PENDING' || link.noticeMessageId || !other.noticeChannelId) return;
      const channelId = other.noticeChannelId;
      const messageId = await tryDiscord(`post an ally request in ${other.name}`, () =>
        discord.send(channelId, requestMessage(actor, other, link.id, link.message)));
      if (!messageId) return;
      const saved = await prisma.guildAlly.updateMany({
        where: { id: link.id, status: 'PENDING', noticeMessageId: null },
        data: { noticeChannelId: channelId, noticeMessageId: messageId },
      });
      if (saved.count === 1) return;
      // Answered or withdrawn on the website while we were posting: show that
      // instead of leaving buttons nobody can use.
      const now = await prisma.guildAlly.findUnique({ where: { id: link.id } });
      if (now?.status === 'PENDING') return;
      const outcome: RequestOutcome = !now ? 'cancelled'
        : now.status === 'ACCEPTED' ? 'accepted' : now.status === 'BLOCKED' ? 'blocked' : 'rejected';
      await tryDiscord(`update the ally request message in ${other.name}`, () =>
        discord.edit(channelId, messageId, answeredMessage(actor, other, link.message, outcome, outcome === 'cancelled' ? null : now?.respondedBy ?? null)));
      return;
    }
    case 'accepted':
    case 'rejected':
    case 'blocked': {
      // actor answered other's request: the request message lives in actor's channel.
      if (p.noticeChannelId && p.noticeMessageId) {
        const [ch, msg] = [p.noticeChannelId, p.noticeMessageId];
        await tryDiscord(`update the ally request message in ${actor.name}`, () =>
          discord.edit(ch, msg, answeredMessage(other, actor, link?.message ?? null, p.event as RequestOutcome, p.actorUserId)));
      }
      // A block is not announced to the blocked org.
      if (p.event !== 'blocked' && other.noticeChannelId) {
        const ch = other.noticeChannelId;
        await tryDiscord(`tell ${other.name} about the answer`, () =>
          discord.send(ch, infoMessage(p.event as 'accepted' | 'rejected', actor, other, link?.retryAfter ?? null)));
      }
      return;
    }
    case 'cancelled': {
      // actor withdrew its request: the message lives in other's channel.
      if (p.noticeChannelId && p.noticeMessageId) {
        const [ch, msg] = [p.noticeChannelId, p.noticeMessageId];
        await tryDiscord(`update the withdrawn ally request in ${other.name}`, () =>
          discord.edit(ch, msg, answeredMessage(actor, other, null, 'cancelled', p.actorUserId)));
      }
      return;
    }
    case 'removed': {
      if (other.noticeChannelId) {
        const ch = other.noticeChannelId;
        await tryDiscord(`tell ${other.name} the alliance ended`, () => discord.send(ch, infoMessage('removed', actor, other, null)));
      }
      return;
    }
  }
}

// ── The buttons ──────────────────────────────────────────────────────────────

/** Guild managers, plus holders of the org's alliance manager roles. */
async function canManageAllies(interaction: ButtonInteraction, allianceManagerRoles: string): Promise<boolean> {
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.ManageGuild) || perms?.has(PermissionFlagsBits.Administrator)) return true;
  let allowed: string[] = [];
  try { allowed = JSON.parse(allianceManagerRoles) as string[]; } catch { allowed = []; }
  if (allowed.length === 0) return false;
  const roles = interaction.member?.roles;
  const held: string[] = !roles ? [] : Array.isArray(roles) ? roles : [...roles.cache.keys()];
  return held.some((r) => allowed.includes(r));
}

const PAST: Record<AllyResponse, AllyNoticeEvent> = { accept: 'accepted', reject: 'rejected', block: 'blocked' };

/**
 * Accept / Reject / Reject and block on an ally request message. Answers the
 * clicker privately; the message itself is updated through handleAllyNotice,
 * the same way as when the request is answered on the website.
 */
export async function handleAllyButton(interaction: ButtonInteraction, discord: AllyDiscord = liveDiscord): Promise<void> {
  const parsed = parseAllyButtonId(interaction.customId);
  if (!parsed) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = (content: string) => interaction.editReply({ content });

  const guild = interaction.guildId
    ? await prisma.guild.findUnique({ where: { guildId: interaction.guildId }, include: { settings: true } })
    : null;
  if (!guild) { await reply('This button only works in the server the request was sent to.'); return; }
  if (!(await canManageAllies(interaction, guild.settings?.allianceManagerRoles ?? '[]'))) {
    await reply('Only officers who manage allies can answer ally requests. Server managers can choose those roles on the Allies page.');
    return;
  }

  const link = await prisma.guildAlly.findUnique({ where: { id: parsed.linkId } });
  if (!link || (link.guildAId !== guild.id && link.guildBId !== guild.id)) {
    await reply('This request no longer exists. It may have been withdrawn.');
    return;
  }
  const d = decideResponse(link, guild.id);
  if (!d.ok) {
    await reply(d.refusal === 'not-pending' ? 'This request was already answered or withdrawn.' : allyRefusalMessage(d.refusal));
    return;
  }

  const changes = responseChanges(parsed.action, guild.id, interaction.user.id, new Date());
  const r = await prisma.guildAlly.updateMany({
    where: { id: link.id, status: 'PENDING', requestedByGuildId: link.requestedByGuildId },
    data: changes,
  });
  if (r.count === 0) { await reply('This request was already answered or withdrawn.'); return; }

  const otherId = link.guildAId === guild.id ? link.guildBId : link.guildAId;
  const other = await prisma.guild.findUnique({ where: { id: otherId }, select: { name: true } });
  await reply({
    accept: `✅ You're now allies with **${other?.name ?? 'that org'}**.`,
    reject: `Request from **${other?.name ?? 'that org'}** rejected. They can ask again in 7 days.`,
    block: `🚫 **${other?.name ?? 'That org'}** is blocked and can't send more requests. Unblock it on the Allies page.`,
  }[parsed.action]);

  await handleAllyNotice({
    event: PAST[parsed.action],
    linkId: link.id,
    actorGuildId: guild.id,
    otherGuildId: otherId,
    actorUserId: interaction.user.id,
    noticeChannelId: interaction.channelId,
    noticeMessageId: interaction.message.id,
  }, discord);
}
