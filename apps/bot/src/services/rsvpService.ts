import { prisma } from '../db.js';
import { client } from '../client.js';
import { updateRosterEmbed } from './eventService.js';

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
 * Post a thread message when a manager drag-reassigns a member to a different role.
 */
export async function announceRoleReassignment(eventId: string, userId: string) {
  const [event, rsvp] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId, userId } } }),
  ]);
  if (!event?.threadId || !rsvp) return;

  const roleLabel = rsvp.role ?? 'Unassigned';

  try {
    const thread = await client.channels.fetch(event.threadId);
    if (thread?.isThread()) {
      await thread.send(`📋 <@${userId}> has been assigned to **${roleLabel}**.`);
    }
  } catch (err) {
    console.error(`[bot] announceRoleReassignment: failed to post to thread ${event.threadId}:`, err);
  }
}

/**
 * Remove a user from the roster entirely.
 * Called when the user clicks the Leave Roster button on the forum embed.
 */
export async function leaveRoster(eventId: string, userId: string) {
  const deleted = await prisma.eventRsvp.deleteMany({
    where: { eventId, userId },
  });
  if (deleted.count === 0) return; // wasn't on the roster — nothing to update

  await updateRosterEmbed(eventId);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (event?.threadId) {
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        await thread.send(`👋 <@${userId}> has left the roster.`);
      }
    } catch (err) {
      console.error(`[bot] leaveRoster: failed to post to thread ${event.threadId}:`, err);
    }
  }
}

/**
 * Add a user to the roster as Unassigned if not already present.
 * Called when the user clicks Interested on a Discord Scheduled Event.
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
    try {
      const thread = await client.channels.fetch(event.threadId);
      if (thread?.isThread()) {
        await thread.send(`👋 <@${userId}> has joined the roster!`);
      } else {
        console.warn(`[bot] joinRoster: channel ${event.threadId} is not a thread`);
      }
    } catch (err) {
      console.error(`[bot] joinRoster: failed to post to thread ${event.threadId}:`, err);
    }
  } else {
    console.warn(`[bot] joinRoster: event ${eventId} has no threadId yet`);
  }
}
