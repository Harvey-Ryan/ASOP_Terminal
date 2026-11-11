// Shared-event notices in Discord (v1.11.0). When an ally shares an event and
// this org approves each one, the bot posts it in the org's ally notices channel
// with Accept / Decline / Open; the message is edited once it's answered (here
// or on the website) or withdrawn. Orgs with no ally notices channel get no
// messages and answer on the website.
//
// The API sends /trigger/share-notice; rules are in packages/shared/src/allies.ts.

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
  parseShareButtonId,
  shareButtonId,
  type ShareNoticeEvent,
  type ShareNoticePayload,
} from '@dem/shared';
import { prisma } from '../db.js';
import { COLOR, iconUrl, label, liveDiscord, loadOrg, tryDiscord, webUrl, type AllyDiscord, type NoticeMessage, type OrgInfo } from './allyNoticeService.js';

/** What the message needs to know about the event. */
export interface SharedEventInfo {
  name: string;
  startTime: Date;
  musterPoint: string | null;
  recurring: boolean;
}

const pendingTab = (discordGuildId: string) => `${webUrl()}/dashboard/servers/${discordGuildId}?tab=pending`;
const when = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:F> (<t:${Math.floor(d.getTime() / 1000)}:R>)`;

function eventEmbed(host: OrgInfo, ev: SharedEventInfo | null, color: number, line: string) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📅 ${label(host)} shared an event`)
    .setDescription(ev ? `**${ev.name}**\n${when(ev.startTime)}\n\n${line}` : line);
  if (ev?.musterPoint) embed.addFields({ name: 'Muster point', value: ev.musterPoint.slice(0, 1024) });
  const ic = iconUrl(host);
  if (ic) embed.setThumbnail(ic);
  return embed;
}

/** The invitation as first posted, with its buttons. */
export function invitationMessage(host: OrgInfo, receiver: OrgInfo, shareId: string, ev: SharedEventInfo): NoticeMessage {
  const embed = eventEmbed(host, ev, COLOR.request,
    `Accept to post it in **${receiver.name}**: a forum thread with the roster, and a Discord event.${ev.recurring ? ' It repeats; each time is shared separately.' : ''}`)
    .setFooter({ text: 'Server managers can answer here or on the website.' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(shareButtonId('accept', shareId)).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(shareButtonId('decline', shareId)).setLabel('Decline').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Open').setStyle(ButtonStyle.Link).setURL(pendingTab(receiver.guildId)),
  );
  return { embeds: [embed.toJSON()], components: [row.toJSON()] };
}

export type ShareOutcome = Exclude<ShareNoticeEvent, 'pending'>;

/** The invitation after it was answered or withdrawn: no buttons. */
export function answeredInvitation(host: OrgInfo, ev: SharedEventInfo | null, outcome: ShareOutcome, actorUserId: string | null): NoticeMessage {
  const by = actorUserId ? ` by <@${actorUserId}>` : '';
  const [line, color] = ({
    accepted: [`✅ Accepted${by}. The bot is posting it in this server.`, COLOR.good],
    declined: [`Declined${by}.`, COLOR.quiet],
    withdrawn: [`Withdrawn. This invitation is no longer open.`, COLOR.quiet],
  } as const)[outcome];
  return { embeds: [eventEmbed(host, ev, color, line).toJSON()], components: [] };
}

// ── Handling a notice from the API ───────────────────────────────────────────

async function loadEvent(eventId: string): Promise<SharedEventInfo | null> {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true, startTime: true, musterPoint: true, recurType: true } });
  return e ? { name: e.name, startTime: e.startTime, musterPoint: e.musterPoint, recurring: !!e.recurType } : null;
}

/**
 * Posts or updates the Discord message for one shared-event invitation. Every
 * Discord call is best-effort: a missing channel or permission is logged and skipped.
 */
export async function handleShareNotice(p: ShareNoticePayload, discord: AllyDiscord = liveDiscord): Promise<void> {
  const [host, receiver, ev] = await Promise.all([loadOrg(p.hostGuildId), loadOrg(p.receiverGuildId), loadEvent(p.eventId)]);
  if (!host || !receiver) return;

  if (p.event === 'pending') {
    const share = await prisma.eventGuildShare.findUnique({ where: { id: p.shareId } });
    // Post only while it's waiting, only once, and only where the org asked for notices.
    if (!share || share.status !== 'PENDING' || share.noticeMessageId || !receiver.noticeChannelId || !ev) return;
    const channelId = receiver.noticeChannelId;
    const messageId = await tryDiscord(`post a shared event in ${receiver.name}`, () =>
      discord.send(channelId, invitationMessage(host, receiver, share.id, ev)));
    if (!messageId) return;
    const saved = await prisma.eventGuildShare.updateMany({
      where: { id: share.id, status: 'PENDING', noticeMessageId: null },
      data: { noticeChannelId: channelId, noticeMessageId: messageId },
    });
    if (saved.count === 1) return;
    // Answered or withdrawn on the website while we were posting: show that
    // instead of leaving buttons nobody can use.
    const now = await prisma.eventGuildShare.findUnique({ where: { id: share.id } });
    if (now?.status === 'PENDING') return;
    const outcome: ShareOutcome = !now ? 'withdrawn' : now.status === 'ACCEPTED' ? 'accepted' : 'declined';
    await tryDiscord(`update the shared event message in ${receiver.name}`, () =>
      discord.edit(channelId, messageId, answeredInvitation(host, ev, outcome, outcome === 'withdrawn' ? null : now?.respondedBy ?? null)));
    return;
  }

  // accepted / declined / withdrawn: edit the invitation, if one was posted.
  if (p.noticeChannelId && p.noticeMessageId) {
    const [ch, msg] = [p.noticeChannelId, p.noticeMessageId];
    await tryDiscord(`update the shared event message in ${receiver.name}`, () =>
      discord.edit(ch, msg, answeredInvitation(host, ev, p.event as ShareOutcome, p.event === 'withdrawn' ? null : p.actorUserId)));
  }
}

// ── The buttons ──────────────────────────────────────────────────────────────

/** Posts an accepted share in the receiving server (eventService, loaded lazily so tests can stub it). */
export type PostShare = (shareId: string) => Promise<void>;
const livePostShare: PostShare = async (shareId) => {
  const { setupDiscordForShare } = await import('./eventService.js');
  await setupDiscordForShare(shareId);
};

/**
 * Accept / Decline on a shared-event invitation. Same rule as the website:
 * server managers of the invited server answer. Answers the clicker privately;
 * the message is updated through handleShareNotice.
 */
export async function handleShareButton(interaction: ButtonInteraction, discord: AllyDiscord = liveDiscord, postShare: PostShare = livePostShare): Promise<void> {
  const parsed = parseShareButtonId(interaction.customId);
  if (!parsed) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = (content: string) => interaction.editReply({ content });

  const guild = interaction.guildId ? await prisma.guild.findUnique({ where: { guildId: interaction.guildId }, select: { id: true } }) : null;
  if (!guild) { await reply('This button only works in the server the event was shared with.'); return; }
  const perms = interaction.memberPermissions;
  if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
    await reply('Only server managers can accept or decline shared events.');
    return;
  }

  const share = await prisma.eventGuildShare.findUnique({ where: { id: parsed.shareId }, include: { event: { select: { name: true, guildId: true } } } });
  if (!share || share.guildId !== guild.id) { await reply('This invitation no longer exists. It may have been withdrawn.'); return; }
  if (share.status !== 'PENDING') { await reply('This invitation was already answered.'); return; }

  const r = await prisma.eventGuildShare.updateMany({
    where: { id: share.id, status: 'PENDING' },
    data: { status: parsed.action === 'accept' ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date(), respondedBy: interaction.user.id },
  });
  if (r.count === 0) { await reply('This invitation was already answered.'); return; }

  await reply(parsed.action === 'accept'
    ? `✅ Accepted. **${share.event.name}** is being posted in this server.`
    : `Declined **${share.event.name}**.`);

  const host = await prisma.guild.findUnique({ where: { guildId: share.event.guildId }, select: { id: true } });
  if (host) {
    await handleShareNotice({
      event: parsed.action === 'accept' ? 'accepted' : 'declined',
      shareId: share.id,
      eventId: share.eventId,
      hostGuildId: host.id,
      receiverGuildId: guild.id,
      actorUserId: interaction.user.id,
      noticeChannelId: interaction.channelId,
      noticeMessageId: interaction.message.id,
    }, discord);
  }
  if (parsed.action === 'accept') {
    await postShare(share.id).catch((err) => console.error(`[shares] Posting share ${share.id} failed (the scheduler retries):`, err));
  }
}
