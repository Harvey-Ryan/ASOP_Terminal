import { EmbedBuilder } from 'discord.js';
import { prisma } from '../db.js';
import { client } from '../client.js';
import { updateRosterEmbed } from './eventService.js';
import type { EventRole } from '@dem/shared';

/**
 * Upsert a roster entry. role=null means Unassigned.
 * Always updates the roster embed after changing.
 */
export async function setRosterRole(
  eventId: string,
  userId: string,
  username: string,
  role: string | null,
) {
  await prisma.eventRsvp.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, username, role },
    update: { role, username },
  });
  await updateRosterEmbed(eventId);
}

/**
 * Remove a user from the roster entirely.
 * Called when the user clicks the Leave Roster button on the forum embed.
 */
export async function leaveRoster(eventId: string, userId: string) {
  const rsvp = await prisma.eventRsvp.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!rsvp) return; // wasn't on the roster — nothing to do

  await prisma.eventRsvp.delete({ where: { eventId_userId: { eventId, userId } } });
  await updateRosterEmbed(eventId);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (event?.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        const embed = new EmbedBuilder()
          .setColor(0x747f8d)
          .setDescription(`🚪 **${rsvp.username}** has left the roster.`);
        await thread.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error(`[bot] leaveRoster: failed to post to thread ${event.threadId}:`, err);
    }
  }
}

/**
 * Post a "👋 X has joined the roster" notification into a thread.
 * Handles: members.add (sends them a Discord notification), thread unarchiving,
 * and the embed message. Silently tolerates Discord API failures.
 */
async function _postJoinNotification(threadId: string, userId: string, username: string) {
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread?.isThread()) {
      await thread.members.add(userId).catch(() => null);
      // Unarchive the thread if Discord auto-archived it due to inactivity.
      // Without this, thread.send() throws on archived threads.
      // We don't re-archive afterwards — the event is still upcoming/active.
      if (thread.archived) await thread.setArchived(false).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`👋 <@${userId}> has joined the roster.`);
      await thread.send({ embeds: [embed] });
    } else {
      console.warn(`[bot] _postJoinNotification: channel ${threadId} is not a thread`);
    }
  } catch (err) {
    console.error(`[bot] _postJoinNotification: failed to post to thread ${threadId}:`, err);
  }
}

/**
 * Add a user to the roster as Unassigned if not already present.
 * Called when the user clicks Interested on a Discord Scheduled Event,
 * or when a member joins the event VC during an active event.
 */
export async function joinRoster(eventId: string, userId: string, username: string) {
  const existing = await prisma.eventRsvp.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (existing) return; // already on roster

  await prisma.eventRsvp.create({ data: { eventId, userId, username, role: null } });
  await updateRosterEmbed(eventId);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (event?.threadId) {
    await _postJoinNotification(event.threadId, userId, username);
  } else {
    console.warn(`[bot] joinRoster: event ${eventId} has no threadId yet`);
  }
}

/**
 * Notify the event thread that a member has joined the roster.
 * Called after a web-dashboard RSVP creates a new roster entry, so the member
 * gets a Discord thread notification (members.add) and a "joined" embed is posted.
 * The RSVP row is expected to already exist when this is called.
 */
export async function notifyThreadJoin(eventId: string, userId: string) {
  const [event, rsvp] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId, userId } } }),
  ]);
  if (!event?.threadId) {
    console.warn(`[bot] notifyThreadJoin: event ${eventId} has no threadId`);
    return;
  }
  const username = rsvp?.username ?? userId;
  await _postJoinNotification(event.threadId, userId, username);
}

// ── Debounced roster update (for web-app admin changes) ───────────────────────

interface DebounceEntry {
  timer: ReturnType<typeof setTimeout>;
  snapshot: { userId: string; username: string; role: string | null }[];
}
const rosterUpdateDebounce = new Map<string, DebounceEntry>();

/**
 * Queue a roster embed refresh + diff announcement for web-app changes.
 * Multiple rapid triggers (e.g. admin dragging members) are collapsed into
 * one update fired 3 seconds after the last trigger.
 */
export async function queueRosterUpdate(eventId: string) {
  const existing = rosterUpdateDebounce.get(eventId);

  if (!existing) {
    // First call — snapshot the current roster state before any further changes
    const rsvps = await prisma.eventRsvp.findMany({ where: { eventId } });
    const snapshot = rsvps.map((r) => ({ userId: r.userId, username: r.username, role: r.role }));
    const timer = setTimeout(() => { flushRosterUpdate(eventId).catch(console.error); }, 3_000);
    rosterUpdateDebounce.set(eventId, { timer, snapshot });
  } else {
    // Subsequent call — reset the timer, keep the original snapshot
    clearTimeout(existing.timer);
    const timer = setTimeout(() => { flushRosterUpdate(eventId).catch(console.error); }, 3_000);
    rosterUpdateDebounce.set(eventId, { ...existing, timer });
  }
}

async function flushRosterUpdate(eventId: string) {
  const entry = rosterUpdateDebounce.get(eventId);
  rosterUpdateDebounce.delete(eventId);
  if (!entry) return;

  // Refresh the embed first
  await updateRosterEmbed(eventId);

  // Fetch current state and diff against snapshot
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event?.threadId) return;

  const currentRsvps = await prisma.eventRsvp.findMany({ where: { eventId } });
  const current = new Map(currentRsvps.map((r) => [r.userId, r]));
  const before = new Map(entry.snapshot.map((r) => [r.userId, r]));

  const joined: string[] = [];
  const left: { userId: string; username: string }[] = [];
  const roleChanged: { userId: string; from: string | null; to: string | null }[] = [];

  for (const [userId, curr] of current) {
    if (!before.has(userId)) {
      joined.push(userId);
    } else {
      const prev = before.get(userId)!;
      if (prev.role !== curr.role) {
        roleChanged.push({ userId, from: prev.role, to: curr.role });
      }
    }
  }
  for (const [userId, prev] of before) {
    if (!current.has(userId)) {
      left.push({ userId, username: prev.username });
    }
  }

  if (joined.length === 0 && left.length === 0 && roleChanged.length === 0) return;

  const eventRoles = event ? (JSON.parse(event.roles) as EventRole[]) : [];
  const roleNameByKey = new Map(eventRoles.map((r) => [r.id ?? r.name, r.name]));

  const embed = new EmbedBuilder()
    .setTitle('📋 Roster Updated')
    .setColor(0x5865f2);

  if (joined.length > 0) {
    embed.addFields({
      name: 'Joined',
      value: joined.map((id) => `<@${id}>`).join(', '),
      inline: false,
    });
  }
  if (left.length > 0) {
    embed.addFields({
      name: 'Left',
      value: left.map((m) => `**${m.username}**`).join(', '),
      inline: false,
    });
  }
  if (roleChanged.length > 0) {
    const lines = roleChanged.map((r) => {
      const from = r.from ? (roleNameByKey.get(r.from) ?? r.from) : 'Unassigned';
      const to = r.to ? (roleNameByKey.get(r.to) ?? r.to) : 'Unassigned';
      return `<@${r.userId}> · ${from} → **${to}**`;
    });
    embed.addFields({ name: 'Role Changes', value: lines.join('\n'), inline: false });
  }

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      await thread.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[bot] flushRosterUpdate: failed to post to thread:', err);
  }
}
