import cron from 'node-cron';
import { ChannelType } from 'discord.js';
import { prisma } from './db.js';
import { client } from './client.js';
import { setupDiscordForEvent, endEvent, deleteEventVcs, createVcsForEvent, postEventLive, updatePostEventEmbed } from './services/eventService.js';
import { joinRoster } from './services/rsvpService.js';
import { closeExpiredAuctions, closeExpiredStandaloneAuctions } from './services/auctionService.js';
import { formatMinutes } from './utils/time.js';

export async function startScheduler() {
  // Refresh the inactivity timer for every ACTIVE event that has VCs.
  // Without this, a stale lastVcActivityAt carried in from before a restart
  // (or from a data migration) would cause checkInactivityEnd() to fire
  // immediately and auto-end events that are still running.
  try {
    const refreshed = await prisma.event.updateMany({
      where: { status: 'ACTIVE', vcIds: { not: '[]' }, lastVcActivityAt: { not: null } },
      data: { lastVcActivityAt: new Date() },
    });
    if (refreshed.count > 0) {
      console.log(`[bot] Refreshed inactivity timer for ${refreshed.count} active event(s) after restart`);
    }
  } catch (err) {
    console.error('[bot] Failed to refresh lastVcActivityAt on startup:', err);
  }

  // Sync Discord scheduled-event subscribers against the roster.
  // GuildScheduledEventUserAdd is ephemeral — clicks missed during downtime are
  // lost unless we fetch the current subscriber list from Discord on startup.
  try {
    const activeEvents = await prisma.event.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE'] }, discordEventId: { not: null } },
      include: { rsvps: true },
    });
    const results = await Promise.allSettled(
      activeEvents
        .filter((e) => e.discordEventId)
        .map(async (event) => {
          const guild = await client.guilds.fetch(event.guildId);
          const scheduled = await guild.scheduledEvents.fetch(event.discordEventId!).catch(() => null);
          if (!scheduled) return 0;
          const subscribers = await scheduled.fetchSubscribers({ withMember: true }).catch(() => null);
          if (!subscribers) return 0;
          const existingIds = new Set(event.rsvps.map((r) => r.userId));
          let count = 0;
          for (const sub of subscribers.values()) {
            if (existingIds.has(sub.user.id)) continue;
            const username = sub.member?.displayName ?? sub.user.username;
            await joinRoster(event.id, sub.user.id, username).catch((err) =>
              console.error(`[bot] Startup sync: joinRoster failed for ${sub.user.id}:`, err),
            );
            count++;
          }
          return count;
        }),
    );

    let syncCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') syncCount += result.value;
      else console.error('[bot] Startup sync: failed for an event:', result.reason);
    }
    if (activeEvents.length > 0) {
      console.log(`[bot] Startup subscriber sync: added ${syncCount} missing subscriber(s) across ${activeEvents.length} event(s)`);
    }
  } catch (err) {
    console.error('[bot] Startup subscriber sync failed:', err);
  }

  cron.schedule('* * * * *', async () => {
    await checkPendingDiscordSetup().catch((e) => console.error('[bot] checkPendingDiscordSetup error:', e));
    await checkReminders().catch((e) => console.error('[bot] checkReminders error:', e));
    await checkEventStart().catch((e) => console.error('[bot] checkEventStart error:', e));
    await checkVcCreation().catch((e) => console.error('[bot] checkVcCreation error:', e));
    await checkVcActivity().catch((e) => console.error('[bot] checkVcActivity error:', e));
    await checkInactivityEnd().catch((e) => console.error('[bot] checkInactivityEnd error:', e));
    await checkEventEnd().catch((e) => console.error('[bot] checkEventEnd error:', e));
    await checkEndedEvents().catch((e) => console.error('[bot] checkEndedEvents error:', e));
    await checkAutoComplete().catch((e) => console.error('[bot] checkAutoComplete error:', e));
    await closeExpiredAuctions().catch((e) => console.error('[bot] closeExpiredAuctions error:', e));
    await closeExpiredStandaloneAuctions().catch((e) => console.error('[bot] closeExpiredStandaloneAuctions error:', e));
  });
  console.log('[bot] Scheduler started');
}

// ── "Event is live" announcement at start time ────────────────────────────────

async function checkEventStart() {
  const now = new Date();

  // Auto-transition PENDING events whose start time has arrived.
  // Events without a threadId stay PENDING so Discord setup can still retry.
  const transitioned = await prisma.event.updateMany({
    where: { status: 'PENDING', startTime: { lte: now }, threadId: { not: null } },
    data: { status: 'ACTIVE' },
  });
  if (transitioned.count > 0) {
    console.log(`[bot] Transitioned ${transitioned.count} event(s) PENDING → ACTIVE at start time`);
  }

  // Post live announcement for ACTIVE events not yet announced.
  const starting = await prisma.event.findMany({
    where: {
      status: 'ACTIVE',
      livePosted: false,
      startTime: { lte: now },
      threadId: { not: null },
    },
    take: 10,
  });
  await Promise.allSettled(
    starting.map((event) =>
      postEventLive(event.id).catch((err) =>
        console.error(`[bot] postEventLive failed for ${event.id}:`, err),
      ),
    ),
  );
}

// ── Discord setup for web-created events ─────────────────────────────────────

async function checkPendingDiscordSetup() {
  // Catch events not yet set up, plus active events where forum thread creation
  // previously failed (e.g. forum channel wasn't configured at the time).
  const pending = await prisma.event.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      OR: [
        { discordEventId: null },
        { threadId: null },
      ],
    },
    take: 5,
  });
  for (const event of pending) {
    await setupDiscordForEvent(event.id).catch((err) =>
      console.error(`[bot] Discord setup failed for event ${event.id}:`, err),
    );
  }
}

// ── Reminder dispatch ─────────────────────────────────────────────────────────

async function checkReminders() {
  const due = await prisma.eventReminder.findMany({
    where: { sent: false, sendAt: { lte: new Date() } },
    include: { event: { include: { rsvps: true } } },
  });

  for (const reminder of due) {
    const { event } = reminder;
    const minsLeft = Math.round((event.startTime.getTime() - Date.now()) / 60_000);
    const when = minsLeft > 0 ? `in ${formatMinutes(minsLeft)}` : 'now';
    const ts = Math.floor(event.startTime.getTime() / 1000);

    if (reminder.type === 'FORUM' && event.threadId) {
      try {
        const thread = await client.channels.fetch(event.threadId);
        if (thread?.isThread()) {
          await thread.send(
            `⏰ **Reminder:** **${event.name}** starts ${when}! (<t:${ts}:F>)`,
          );
        }
      } catch (err) {
        console.error(`[bot] Forum reminder failed for event ${event.id}:`, err);
      }
    }

    if (reminder.type === 'DM') {
      // Fetch current VC member IDs for this event
      const vcIds = JSON.parse(event.vcIds) as string[];
      const membersInVc = new Set<string>();

      for (const vcId of vcIds) {
        const ch = client.channels.cache.get(vcId);
        if (ch?.type === ChannelType.GuildVoice) {
          ch.members.forEach((m) => membersInVc.add(m.id));
        }
      }

      // Batch-load notification prefs for all RSVPs that are not in a VC
      const eligibleRsvps = event.rsvps.filter((rsvp) => !membersInVc.has(rsvp.userId));
      const discordIds = eligibleRsvps.map((r) => r.userId);
      const usersWithPrefs = discordIds.length > 0
        ? await prisma.user.findMany({
            where: { discordId: { in: discordIds } },
            select: { discordId: true, notificationPrefs: { select: { dmEventReminder: true } } },
          })
        : [];
      const prefsMap = new Map<string, { dmEventReminder: boolean } | null>(
        usersWithPrefs.map((u) => [u.discordId, u.notificationPrefs]),
      );

      const webUrl = process.env['WEB_URL'] ?? 'http://localhost:5173';
      const notifFooter = `\n\nChange notification settings: ${webUrl}/dashboard/settings/notifications`;

      // DM roster members who are NOT in a monitored VC and have not opted out
      const dmTargets = eligibleRsvps.filter((rsvp) => {
        const prefs = prefsMap.get(rsvp.userId);
        // Unknown user or no saved prefs → default opt-in
        return prefs === undefined || prefs === null || (prefs.dmEventReminder !== false);
      });

      if (dmTargets.length === 0) {
        // No one to DM — mark sent so we don't revisit this reminder
        await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sent: true } });
        continue;
      }

      const dmResults = await Promise.allSettled(
        dmTargets.map(async (rsvp) => {
          const user = await client.users.fetch(rsvp.userId);
          await user.send(
            `${event.name} starts in 15 minutes! Join a voice channel to participate.\nMuster Point: ${event.musterPoint ?? 'See event details'}${notifFooter}`,
          );
        }),
      );

      const anySucceeded = dmResults.some((r) => r.status === 'fulfilled');
      if (anySucceeded) {
        await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sent: true } });
      } else {
        console.error(`[bot] All DMs failed for reminder ${reminder.id} (event ${event.id}) — will retry next tick`);
      }

      continue; // skip the unconditional update below for DM reminders
    }

    await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sent: true } });
  }
}

// ── Voice channel creation (30 min before start) ──────────────────────────────

async function checkVcCreation() {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: {
      // Include ACTIVE: setupDiscordForEvent moves events from PENDING → ACTIVE
      // immediately, so PENDING events in the 30-min window are rare. Without
      // ACTIVE here, VCs are never auto-created for fully set-up events.
      status: { in: ['PENDING', 'ACTIVE'] },
      vcIds: '[]',
      startTime: {
        gte: now,
        lte: new Date(now.getTime() + 30 * 60_000),
      },
    },
  });

  for (const event of events) {
    await createVcsForEvent(event.id).catch((err) =>
      console.error(`[bot] VC creation failed for event ${event.id}:`, err),
    );
  }
}

// ── VC presence / activity tracking ──────────────────────────────────────────

async function checkVcActivity() {
  const events = await prisma.event.findMany({
    where: { status: 'ACTIVE', vcIds: { not: '[]' } },
  });

  const activeEventIds: string[] = [];
  for (const event of events) {
    const vcIds = JSON.parse(event.vcIds) as string[];
    const anyPresent = vcIds.some((vcId) => {
      const ch = client.channels.cache.get(vcId);
      return ch?.type === ChannelType.GuildVoice && ch.members.size > 0;
    });
    if (anyPresent) activeEventIds.push(event.id);
  }

  if (activeEventIds.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: activeEventIds } },
      data: { lastVcActivityAt: new Date() },
    });
  }
}

// ── Inactivity auto-end (30 min with no VC presence after VCs were created) ───

async function checkInactivityEnd() {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const events = await prisma.event.findMany({
    where: {
      status: 'ACTIVE',
      lastVcActivityAt: { not: null, lte: cutoff },
    },
  });

  for (const event of events) {
    const vcIds = JSON.parse(event.vcIds) as string[];
    if (vcIds.length === 0) continue; // only apply to events that had VCs

    console.log(`[bot] Auto-ending event ${event.id} (${event.name}) due to VC inactivity`);
    await prisma.event.update({ where: { id: event.id }, data: { status: 'ENDED' } });
  }
}

// ── End events whose endTime has passed ──────────────────────────────────────

async function checkEventEnd() {
  const now = new Date();
  const transitioned = await prisma.event.updateMany({
    where: { status: 'ACTIVE', endTime: { not: null, lte: now } },
    data: { status: 'ENDED' },
  });
  if (transitioned.count > 0) {
    console.log(`[bot] Transitioned ${transitioned.count} event(s) ACTIVE → ENDED at end time`);
  }
}

// ── Auto-complete ENDED events after 24h grace period ────────────────────────

async function checkAutoComplete() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const events = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      botCleanedUp: true,
      endTime: { not: null, lte: cutoff },
    },
    take: 10,
  });

  for (const event of events) {
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: event.id }, data: { status: 'COMPLETED' } });
      await tx.eventGuildShare.updateMany({
        where: { eventId: event.id, status: 'PENDING' },
        data: { status: 'DECLINED', respondedAt: new Date() },
      });
    });
    console.log(`[bot] Auto-completed event ${event.id} (${event.name}) after 24h grace period`);
    await updatePostEventEmbed(event.id).catch((err) =>
      console.error(`[bot] updatePostEventEmbed failed for ${event.id}:`, err),
    );
  }
}

// ── Process ENDED events (thread cleanup backstop + deferred VC deletion) ────

async function checkEndedEvents() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);

  // ── Phase 1: thread/embed cleanup backstop ────────────────────────────────
  // 2-minute updatedAt guard prevents racing the API trigger that calls endEvent()
  // directly. The scheduler only acts as a backstop if the bot was down or the
  // trigger call failed.
  const needsEndEvent = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      botCleanedUp: false,
      botEndedAt: null,
      updatedAt: { lte: twoMinutesAgo },
    },
    take: 5,
  });

  for (const event of needsEndEvent) {
    await endEvent(event.id).catch((err) =>
      console.error(`[bot] endEvent backstop failed for ${event.id}:`, err),
    );
  }

  // ── Phase 2: deferred VC deletion with 5-min empty timer ─────────────────
  // Uses botEndedAt (not updatedAt) as the guard so that intermediate state
  // writes (setting vcsEmptiedAt, resetting it when occupied) don't cause the
  // event to disappear from this query for 2 minutes each time.
  const needsVcCleanup = await prisma.event.findMany({
    where: {
      status: { in: ['ENDED', 'COMPLETED'] },
      botCleanedUp: false,
      botEndedAt: { not: null },
    },
    take: 5,
  });

  for (const event of needsVcCleanup) {
    const vcIds = JSON.parse(event.vcIds) as string[];

    if (vcIds.length === 0) {
      await prisma.event.update({ where: { id: event.id }, data: { botCleanedUp: true } });
      continue;
    }

    const anyonePresent = vcIds.some((vcId) => {
      const ch = client.channels.cache.get(vcId);
      return ch?.type === ChannelType.GuildVoice && ch.members.size > 0;
    });

    if (anyonePresent) {
      // VCs still occupied — reset the empty timer if it was running
      if (event.vcsEmptiedAt) {
        await prisma.event.update({ where: { id: event.id }, data: { vcsEmptiedAt: null } });
      }
      continue;
    }

    // VCs are empty — start or check the 5-minute timer
    if (!event.vcsEmptiedAt) {
      await prisma.event.update({ where: { id: event.id }, data: { vcsEmptiedAt: new Date() } });
      continue; // will delete on the next pass after 5 min
    }

    if (event.vcsEmptiedAt > fiveMinutesAgo) {
      continue; // not yet 5 minutes empty — no DB write, no updatedAt bump
    }

    // 5 minutes have elapsed with empty VCs — delete them
    await deleteEventVcs(event.id).catch((err) =>
      console.error(`[bot] deleteEventVcs failed for ${event.id}:`, err),
    );
  }
}

