// Changes through the AI assistant (v1.57.0): sign-ups for anyone, and for
// officers creating events from templates, editing, cancelling and sharing
// them. The model never makes a change. Its tool call only *prepares* one:
// this file checks it (permissions, the event, the role, the time), writes a
// plain preview, and keeps it for ACTION_CONFIRM_MS. The bot shows the preview
// under the answer with Confirm / Cancel, and only the person who asked can
// press them. Confirm runs the change through the same code as the buttons and
// the website (and checks permission again).
//
// Left out on purpose: handing out loot, changing DKP, roles and server settings.

import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, type ButtonInteraction, type Guild, type GuildMember,
} from 'discord.js';
import type { Event, Prisma } from '@prisma/client';
import {
  ACTION_CONFIRM_MS, ROLE_SIGNUP_MESSAGES, WAITLIST_MESSAGES, canRunEventFromDiscord, findRole, isValidTimeZone,
  parseLocalDateTime, planShares, roleKeyOf, roleSignupProblem, type EventRole,
} from '@dem/shared';
import { prisma } from '../db.js';
import { hiddenModules } from '../utils/hiddenModules.js';
import { withRef } from '../utils/errorLog.js';
import { leaveRoster, notifyThreadJoin, setRosterRole } from './rsvpService.js';
import { clickWaitlist } from './waitlistService.js';
import {
  cancelEvent, copyTemplateBriefing, guildTimezone, scheduleRosterRefresh, setupDiscordForEvent, setupDiscordForShare, syncDiscordEvent,
} from './eventService.js';
import { handleShareNotice } from './shareNoticeService.js';

export interface ActionContext {
  guild: Guild;
  member: GuildMember;
  userId: string;
  /** The change this question prepared (one per question). */
  prepared: PreparedAction | null;
}

export interface PreparedAction {
  id: string;
  guildId: string;
  userId: string;
  /** What will happen, in plain words with Discord timestamps (shown above the buttons). */
  preview: string;
  expiresAt: number;
  /** Does it; returns what to tell the member. Checks permission again first. */
  run: () => Promise<string>;
}

const pending = new Map<string, PreparedAction>();
const ts = (d: Date, style = 'F') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const parseRoles = (json: string): EventRole[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };
const OPEN = ['PENDING', 'ACTIVE'];

// ── Who and where ────────────────────────────────────────────────────────────

/** The asker's time zone: their member-map pin's, else the server's, else UTC. */
export async function askerTimeZone(guildId: string, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { discordId: userId }, select: { id: true } });
  const pin = user ? await prisma.memberPin.findFirst({ where: { userId: user.id, timezone: { not: null } }, select: { timezone: true }, orderBy: { updatedAt: 'desc' } }) : null;
  if (pin?.timezone && isValidTimeZone(pin.timezone)) return pin.timezone;
  return guildTimezone(guildId);
}

async function eventBotOn(guildId: string): Promise<boolean> {
  if ((await hiddenModules()).has('eventBotEnabled')) return false;
  const s = await prisma.guildSettings.findFirst({ where: { guild: { guildId } }, select: { eventBotEnabled: true } });
  return s?.eventBotEnabled !== false;
}

async function creatorRoles(guildId: string): Promise<string | null> {
  const s = await prisma.guildSettings.findFirst({ where: { guild: { guildId } }, select: { eventCreatorRoles: true } });
  return s?.eventCreatorRoles ?? null;
}

/** The website's event-creator rule (canRunEventFromDiscord): for a new event, or one event. */
export async function isEventOfficer(member: GuildMember, event?: Pick<Event, 'guildId' | 'createdById'>): Promise<boolean> {
  return canRunEventFromDiscord({
    isCreator: !!event && event.createdById === member.id,
    inHostServer: !event || event.guildId === member.guild.id,
    isOwner: member.guild.ownerId === member.id,
    manageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    administrator: member.permissions.has(PermissionFlagsBits.Administrator),
    memberRoleIds: [...member.roles.cache.keys()],
    eventCreatorRoles: await creatorRoles(member.guild.id),
  });
}

/**
 * The open event a name means: this server's own (`own`) or any it can see.
 * The soonest match; the others are named so the model can ask which.
 */
async function findOpenEvent(guildId: string, name: string, own: boolean): Promise<{ event: Event | null; others: string[] }> {
  if (!name) return { event: null, others: [] };
  const where: Prisma.EventWhereInput = {
    name: { contains: name, mode: 'insensitive' }, status: { in: OPEN },
    ...(own ? { guildId } : { OR: [{ guildId }, { allianceGuilds: { some: { discordGuildId: guildId } } }, { guildShares: { some: { status: 'ACCEPTED' as const, guild: { guildId } } } }] }),
  };
  const found = await prisma.event.findMany({ where, orderBy: { startTime: 'asc' }, take: 4 });
  const exact = found.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const event = exact ?? found[0] ?? null;
  return { event, others: found.filter((e) => e !== event).map((e) => `${e.name} (${ts(e.startTime, 'f')})`) };
}

const notFound = (name: string, own: boolean) =>
  `No upcoming event matching "${name}"${own ? ' hosted by this server' : ''}. Nothing was prepared.`;

function prepare(ctx: ActionContext, preview: string, run: () => Promise<string>): string {
  if (ctx.prepared) return 'Only one change per question. Nothing more was prepared.';
  const action: PreparedAction = { id: randomUUID(), guildId: ctx.guild.id, userId: ctx.userId, preview, expiresAt: Date.now() + ACTION_CONFIRM_MS, run };
  ctx.prepared = action;
  return `Prepared, NOT done yet: ${preview}\nThe member must press Confirm under your reply. Tell them what will happen; don't say it's done.`;
}

// ── Sign-ups (anyone) ────────────────────────────────────────────────────────

async function signUp(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  if (!(await eventBotOn(ctx.guild.id))) return 'Events are switched off in this server.';
  const name = str(args['event']);
  const { event, others } = await findOpenEvent(ctx.guild.id, name, false);
  if (!event) return notFound(name, false);
  const roles = parseRoles(event.roles);
  const roleName = str(args['role'], 100);
  const maybe = args['maybe'] === true && !roleName;
  const role = roleName ? roles.find((r) => r.name.toLowerCase() === roleName.toLowerCase()) ?? roles.find((r) => r.name.toLowerCase().includes(roleName.toLowerCase())) : undefined;
  if (roleName && !role) return `"${event.name}" has no role called "${roleName}". Its roles: ${roles.map((r) => r.name).join(', ') || 'none (sign up without a role)'}. Nothing was prepared.`;
  const rsvps = await prisma.eventRsvp.findMany({ where: { eventId: event.id }, select: { userId: true, role: true, tentative: true } });
  const mine = rsvps.find((r) => r.userId === ctx.userId);
  const key = role ? roleKeyOf(role) : null;
  const why = role ? roleSignupProblem(roles, rsvps, key!, ctx.userId, ctx.guild.id) : null;
  if (why === 'other-server' || why === 'unknown') return `${ROLE_SIGNUP_MESSAGES[why]} Nothing was prepared.`;
  if (mine && !mine.tentative && mine.role === key && !maybe) return `They're already signed up for ${event.name}${role ? ` as ${role.name}` : ''}. Nothing to change.`;
  const when = `**${event.name}** (${ts(event.startTime)})`;
  const displayName = ctx.member.displayName;
  const wasOn = !!mine;
  const extra = others.length ? `\nOther events with that name: ${others.join('; ')}.` : '';

  if (why === 'full') {
    return prepare(ctx, `Put you on the **${role!.name}** waitlist for ${when}: the role is full. You keep your current spot until a slot opens.`, async () => {
      const r = await clickWaitlist(event.id, ctx.userId, displayName, key!, ctx.guild.id);
      if (r.joinedRoster) notifyThreadJoin(event.id, ctx.userId).catch((err) => console.error('[assistant] join notice:', err));
      scheduleRosterRefresh(event.id).catch((err) => console.error('[assistant] roster refresh:', err));
      if (r.result === 'joined') return `⏳ You're #${r.position} in line for **${r.roleName}**.`;
      if (r.result === 'open') return `A **${r.roleName}** slot opened up meanwhile: ask again to take it.`;
      if (r.result === 'left') return `You were already in that line, so you've now left it.`;
      if (r.result === 'has-role') return `You already have **${r.roleName}**.`;
      return `⚠️ ${WAITLIST_MESSAGES[r.result]}`;
    }) + extra;
  }
  const what = maybe ? 'as **maybe**' : role ? `as **${role.name}**` : 'without a role';
  return prepare(ctx, `Sign you up for ${when} ${what}.`, async () => {
    const current = await prisma.event.findUnique({ where: { id: event.id }, select: { status: true } });
    if (!current || !OPEN.includes(current.status)) return 'That event has ended or been cancelled.';
    const problem = await setRosterRole(event.id, ctx.userId, displayName, key, ctx.guild.id, maybe);
    if (problem) return `⚠️ ${ROLE_SIGNUP_MESSAGES[problem]}`;
    if (!wasOn) notifyThreadJoin(event.id, ctx.userId).catch((err) => console.error('[assistant] join notice:', err));
    return `✅ You're signed up for **${event.name}** ${what}.`;
  }) + extra;
}

async function leaveEvent(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  const name = str(args['event']);
  const { event } = await findOpenEvent(ctx.guild.id, name, false);
  if (!event) return notFound(name, false);
  const on = await prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId: event.id, userId: ctx.userId } } });
  if (!on) return `They aren't on the roster for ${event.name}. Nothing to change.`;
  return prepare(ctx, `Take you off the roster for **${event.name}** (${ts(event.startTime)}), and out of any waitlist for it.`, async () => {
    await leaveRoster(event.id, ctx.userId);
    return `✅ You're off the roster for **${event.name}**.`;
  });
}

// ── Officer changes ──────────────────────────────────────────────────────────

const NOT_OFFICER = "They can't do that here: it needs event-creator rights in this server (an event creator role, Manage Server, or being the event's creator). Nothing was prepared.";

/** Same reminders as the website (1 h and 30 min in the thread, a DM 15 min before). */
async function resetReminders(eventId: string, start: Date) {
  await prisma.eventReminder.deleteMany({ where: { eventId, sent: false } });
  const now = Date.now();
  const rows = [
    { eventId, sendAt: new Date(start.getTime() - 60 * 60_000), type: 'FORUM' },
    { eventId, sendAt: new Date(start.getTime() - 30 * 60_000), type: 'FORUM' },
    { eventId, sendAt: new Date(start.getTime() - 15 * 60_000), type: 'DM' },
  ].filter((r) => r.sendAt.getTime() > now);
  if (rows.length) await prisma.eventReminder.createMany({ data: rows });
}

async function readStart(ctx: ActionContext, value: unknown): Promise<{ at: Date; tz: string } | string> {
  const tz = await askerTimeZone(ctx.guild.id, ctx.userId);
  const at = parseLocalDateTime(value, tz);
  if (!at) return `"${String(value)}" isn't a date and time I can read; use "YYYY-MM-DDTHH:mm" in ${tz}. Nothing was prepared.`;
  if (at.getTime() < Date.now() + 5 * 60_000) return 'That time has already passed (or is under 5 minutes away). Nothing was prepared.';
  if (at.getTime() > Date.now() + 366 * 86_400_000) return 'That is more than a year away. Nothing was prepared.';
  return { at, tz };
}

async function createEvent(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  if (!(await eventBotOn(ctx.guild.id))) return 'Events are switched off in this server.';
  if (!(await isEventOfficer(ctx.member))) return NOT_OFFICER;
  const host = await prisma.guild.findUnique({ where: { guildId: ctx.guild.id }, select: { id: true } });
  const templates = host ? await prisma.eventTemplate.findMany({ where: { guildId: host.id, isActive: true }, orderBy: { name: 'asc' }, take: 100 }) : [];
  if (!templates.length) return 'This server has no event templates yet (make them on the website\'s Templates page). Nothing was prepared.';
  const q = str(args['template'], 200).toLowerCase();
  const tmpl = templates.find((t) => t.name.toLowerCase() === q) ?? templates.find((t) => t.name.toLowerCase().includes(q) && q);
  if (!tmpl) return `No template called "${args['template']}". Templates: ${templates.slice(0, 20).map((t) => t.name).join(', ')}. Nothing was prepared.`;
  const start = await readStart(ctx, args['start']);
  if (typeof start === 'string') return start;
  const name = str(args['name'], 200) || tmpl.name;
  const roles = parseRoles(tmpl.roles);
  const end = tmpl.defaultDuration ? new Date(start.at.getTime() + tmpl.defaultDuration * 60_000) : null;
  const preview = `Create **${name}** from the **${tmpl.name}** template, starting ${ts(start.at)} (${ts(start.at, 'R')})`
    + `${roles.length ? `, roles ${roles.map((r) => `${r.name} ×${r.count}`).join(', ')}` : ''}${tmpl.briefing ? ', with its briefing as a draft' : ''}. It's posted in the event forum as usual.`;
  return prepare(ctx, preview, async () => {
    if (!(await isEventOfficer(ctx.member))) return '⚠️ You no longer have event-creator rights here.';
    const event = await prisma.event.create({ data: {
      guildId: ctx.guild.id, name, description: tmpl.description, musterPoint: tmpl.musterPoint, imageUrl: tmpl.imageUrl,
      startTime: start.at, endTime: end, roles: tmpl.roles, vcNames: tmpl.vcNames, briefingChannel: tmpl.briefingChannel,
      createdById: ctx.userId, status: 'PENDING', templateId: tmpl.id,
    } });
    await prisma.eventTemplateUse.create({ data: { templateId: tmpl.id } });
    await resetReminders(event.id, start.at);
    await copyTemplateBriefing(tmpl.id, event.id, event.roles, ctx.userId).catch((err) => console.error('[assistant] template briefing:', err));
    await setupDiscordForEvent(event.id);
    const web = process.env['WEB_URL'] ?? 'http://localhost:5173';
    return `✅ **${name}** is created for ${ts(start.at)}. Edit it on the website: ${web}/dashboard/servers/${ctx.guild.id}`;
  });
}

async function editEvent(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['event']);
  const { event } = await findOpenEvent(ctx.guild.id, q, true);
  if (!event) return notFound(q, true);
  if (!(await isEventOfficer(ctx.member, event))) return NOT_OFFICER;
  const changes: string[] = [];
  const data: Prisma.EventUpdateInput = {};
  let start: Date | null = null;
  if (args['start'] !== undefined && args['start'] !== null && args['start'] !== '') {
    const s = await readStart(ctx, args['start']);
    if (typeof s === 'string') return s;
    if (s.at.getTime() !== event.startTime.getTime()) {
      start = s.at;
      data.startTime = s.at;
      // Keep the length; a repeating series re-anchors to the new time (as on the website).
      if (event.endTime) data.endTime = new Date(s.at.getTime() + (event.endTime.getTime() - event.startTime.getTime()));
      if (event.recurType) { data.recurAnchor = s.at; data.recurTimezone = s.tz; }
      changes.push(`start ${ts(event.startTime)} → ${ts(s.at)}${event.recurType ? ' (later repeats move with it)' : ''}`);
    }
  }
  const name = str(args['name'], 200);
  if (name && name !== event.name) { data.name = name; changes.push(`name → "${name}"`); }
  const description = typeof args['description'] === 'string' ? args['description'].trim().slice(0, 2000) : null;
  if (description !== null && description !== (event.description ?? '')) { data.description = description || null; changes.push(description ? 'new description' : 'description removed'); }
  if (!changes.length) return 'Nothing to change: give a new start, name or description.';
  if (event.status === 'ACTIVE' && start) return "It's already running, so its start can't move. Nothing was prepared.";
  return prepare(ctx, `Change **${event.name}**: ${changes.join('; ')}. Everyone signed up sees the update in Discord.`, async () => {
    const current = await prisma.event.findUnique({ where: { id: event.id } });
    if (!current || !OPEN.includes(current.status)) return 'That event has ended or been cancelled.';
    if (!(await isEventOfficer(ctx.member, current))) return '⚠️ You no longer have event-creator rights here.';
    await prisma.event.update({ where: { id: event.id }, data });
    if (start) await resetReminders(event.id, start);
    await syncDiscordEvent(event.id);
    return `✅ **${name || event.name}** updated.`;
  });
}

async function cancelOne(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['event']);
  const { event } = await findOpenEvent(ctx.guild.id, q, true);
  if (!event) return notFound(q, true);
  if (!(await isEventOfficer(ctx.member, event))) return NOT_OFFICER;
  if (event.status !== 'PENDING') return "It's already running: end it instead (the event's End button, or /event end). Nothing was prepared.";
  const signedUp = await prisma.eventRsvp.count({ where: { eventId: event.id, tentative: false } });
  return prepare(ctx, `Cancel **${event.name}** (${ts(event.startTime)})${event.recurType ? ' and stop it repeating' : ''}. ${signedUp} signed up; its Discord posts say it's cancelled.`, async () => {
    const current = await prisma.event.findUnique({ where: { id: event.id } });
    if (!current || current.status !== 'PENDING') return 'That event has already started, ended or been cancelled.';
    if (!(await isEventOfficer(ctx.member, current))) return '⚠️ You no longer have event-creator rights here.';
    // As the website's stop-repeating does: no more reminders, open invitations to allies withdrawn.
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: event.id }, data: { status: 'CANCELLED', recurType: null } });
      await tx.eventReminder.deleteMany({ where: { eventId: event.id, sent: false } });
      await tx.eventGuildShare.updateMany({ where: { eventId: event.id, status: 'PENDING' }, data: { status: 'DECLINED', respondedAt: new Date() } });
    });
    await cancelEvent(event.id);
    return `✅ **${event.name}** is cancelled.`;
  });
}

async function shareEvent(ctx: ActionContext, args: Record<string, unknown>): Promise<string> {
  const q = str(args['event']);
  const { event } = await findOpenEvent(ctx.guild.id, q, true);
  if (!event) return notFound(q, true);
  if (!(await isEventOfficer(ctx.member, event))) return NOT_OFFICER;
  const host = await prisma.guild.findUnique({ where: { guildId: ctx.guild.id }, select: { id: true } });
  if (!host) return 'This server is not set up on ASOP yet.';
  const links = await prisma.guildAlly.findMany({ where: { status: 'ACCEPTED', OR: [{ guildAId: host.id }, { guildBId: host.id }] } });
  const allyIds = links.map((l) => (l.guildAId === host.id ? l.guildBId : l.guildAId));
  const allies = await prisma.guild.findMany({ where: { id: { in: allyIds } }, select: { id: true, guildId: true, name: true, settings: { select: { allianceTag: true } } } });
  if (!allies.length) return "This server has no allies yet (add them on the website's Allies page). Nothing was prepared.";
  const a = str(args['ally'], 100).toLowerCase();
  const ally = allies.find((g) => g.name.toLowerCase() === a || g.settings?.allianceTag?.toLowerCase() === a)
    ?? allies.find((g) => a && g.name.toLowerCase().includes(a));
  if (!ally) return `No ally called "${args['ally']}". Allies: ${allies.map((g) => g.name).join(', ')}. Nothing was prepared.`;
  const plan = planShares(host.id, [ally.id], links);
  if (plan.notAllies.length) return `${ally.name} doesn't take shared events from this server (check the Allies page). Nothing was prepared.`;
  const existing = await prisma.eventGuildShare.findUnique({ where: { eventId_guildId: { eventId: event.id, guildId: ally.id } } });
  if (existing?.status === 'ACCEPTED') return `${event.name} is already shared with ${ally.name}.`;
  if (existing?.status === 'PENDING') return `${ally.name} already has an invitation for ${event.name} waiting.`;
  const auto = plan.accepted.includes(ally.id) && !existing; // asked again after a decline: they choose again
  return prepare(ctx, `Share **${event.name}** (${ts(event.startTime)}) with **${ally.name}**: ${auto ? 'they post your shared events automatically, so it appears in their server straight away' : 'they get an invitation to accept or decline'}.`, async () => {
    const current = await prisma.event.findUnique({ where: { id: event.id } });
    if (!current || !OPEN.includes(current.status)) return 'That event has ended or been cancelled.';
    if (!(await isEventOfficer(ctx.member, current))) return '⚠️ You no longer have event-creator rights here.';
    const now = new Date();
    const share = existing
      ? await prisma.eventGuildShare.update({ where: { id: existing.id }, data: { status: 'PENDING', respondedAt: null, respondedBy: null, autoAccepted: false, invitedAt: now, noticeChannelId: null, noticeMessageId: null, setupAttempts: 0, nextSetupAt: null } })
      : await prisma.eventGuildShare.create({ data: { eventId: event.id, guildId: ally.id, sourceType: 'DIRECT', status: auto ? 'ACCEPTED' : 'PENDING', autoAccepted: auto, respondedAt: auto ? now : null } });
    if (share.status === 'ACCEPTED') await setupDiscordForShare(share.id);
    else await handleShareNotice({ event: 'pending', shareId: share.id, eventId: event.id, hostGuildId: host.id, receiverGuildId: ally.id, actorUserId: null, noticeChannelId: null, noticeMessageId: null });
    return share.status === 'ACCEPTED' ? `✅ **${event.name}** is shared with **${ally.name}**.` : `✅ **${ally.name}** has been invited to **${event.name}**.`;
  });
}

export const ACTION_RUNNERS: Record<string, (ctx: ActionContext, args: Record<string, unknown>) => Promise<string>> = {
  sign_up: signUp,
  leave_event: leaveEvent,
  create_event: createEvent,
  edit_event: editEvent,
  cancel_event: cancelOne,
  share_event: shareEvent,
};

// ── Confirm / Cancel ─────────────────────────────────────────────────────────

/** Keeps a prepared change and gives the buttons for it. */
export function offerAction(action: PreparedAction): ActionRowBuilder<ButtonBuilder> {
  for (const [id, a] of pending) if (a.expiresAt < Date.now()) pending.delete(id);
  pending.set(action.id, action);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ai:ok:${action.id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ai:no:${action.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/** The preview line under an answer (written by the bot, not the model). */
export const previewLine = (a: PreparedAction) => `\n\n**When you confirm:** ${a.preview}\n-# Expires ${ts(new Date(a.expiresAt), 'R')}.`;

/** A press on Confirm or Cancel ("ai:ok:<id>" / "ai:no:<id>"). */
export async function handleActionButton(interaction: ButtonInteraction): Promise<void> {
  const [, verb, id] = interaction.customId.split(':');
  const action = id ? pending.get(id) : undefined;
  if (action && action.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who asked can confirm or cancel this.', flags: MessageFlags.Ephemeral });
    return;
  }
  const base = interaction.message.content.replace(/\n-# Expires <t:\d+:R>\.$/, '');
  if (!action || action.expiresAt < Date.now()) {
    if (id) pending.delete(id);
    await interaction.update({ content: `${base}\n-# ⌛ This expired, so nothing was changed. Ask again if you still want it.`, components: [] });
    return;
  }
  pending.delete(action.id);
  if (verb !== 'ok') {
    await interaction.update({ content: `${base}\n-# Cancelled: nothing was changed.`, components: [] });
    return;
  }
  await interaction.update({ content: `${base}\n-# Working on it…`, components: [] });
  let result: string;
  try {
    result = await action.run();
  } catch (err) {
    console.error('[assistant] confirmed change failed:', err);
    result = withRef('❌ That didn\'t work, and may be partly done. Check on the website.');
  }
  await interaction.editReply({ content: `${base}\n${result}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => null);
}
