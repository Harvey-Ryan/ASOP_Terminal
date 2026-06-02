import cron from 'node-cron';
import { ChannelType } from 'discord.js';
import { prisma } from './db.js';
import { client } from './client.js';
import { setupDiscordForEvent, endEvent, deleteEventVcs, createVcsForEvent, postEventLive } from './services/eventService.js';
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
    let syncCount = 0;
    for (const event of activeEvents) {
      if (!event.discordEventId) continue;
      try {
        const guild = await client.guilds.fetch(event.guildId);
        const scheduled = await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null);
        if (!scheduled) continue;
        const subscribers = await scheduled.fetchSubscribers({ withMember: true }).catch(() => null);
        if (!subscribers) continue;
        const existingIds = new Set(event.rsvps.map((r) => r.userId));
        for (const sub of subscribers.values()) {
          if (existingIds.has(sub.user.id)) continue;
          const username = sub.member?.displayName ?? sub.user.username;
          await joinRoster(event.id, sub.user.id, username).catch((err) =>
            console.error(`[bot] Startup sync: joinRoster failed for ${sub.user.id}:`, err),
          );
          syncCount++;
        }
      } catch (err) {
        console.error(`[bot] Startup sync: failed for event ${event.id}:`, err);
      }
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
    await checkEndedEvents().catch((e) => console.error('[bot] checkEndedEvents error:', e));
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
  for (const event of starting) {
    await postEventLive(event.id).catch((err) =>
      console.error(`[bot] postEventLive failed for ${event.id}:`, err),
    );
  }
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
        try {
          const ch = await client.channels.fetch(vcId);
          if (ch?.type === ChannelType.GuildVoice) {
            ch.members.forEach((m) => membersInVc.add(m.id));
          }
        } catch {
          // VC may not exist yet — that's fine
        }
      }

      // DM roster members who are NOT in a monitored VC
      for (const rsvp of event.rsvps) {
        if (membersInVc.has(rsvp.userId)) continue;
        try {
          const user = await client.users.fetch(rsvp.userId);
          await user.send(
            `⏰ **${event.name}** starts in 15 minutes! Join a voice channel to participate.\n📍 Muster Point: ${event.musterPoint ?? 'See event details'}`,
          );
        } catch {
          // DMs may be disabled — silently skip
        }
      }
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
    where: { status: 'ACTIVE' },
  });

  for (const event of events) {
    const vcIds = JSON.parse(event.vcIds) as string[];
    if (vcIds.length === 0) continue;

    let anyPresent = false;
    for (const vcId of vcIds) {
      try {
        const ch = await client.channels.fetch(vcId);
        if (ch?.type === ChannelType.GuildVoice && ch.members.size > 0) {
          anyPresent = true;
          break;
        }
      } catch {
        // Channel deleted or unavailable
      }
    }

    if (anyPresent) {
      await prisma.event.update({
        where: { id: event.id },
        data: { lastVcActivityAt: new Date() },
      });
    }
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
      status: 'ENDED',
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

    let anyonePresent = false;
    for (const vcId of vcIds) {
      try {
        const ch = await client.channels.fetch(vcId);
        if (ch?.type === ChannelType.GuildVoice && ch.members.size > 0) {
          anyonePresent = true;
          break;
        }
      } catch {
        // VC unavailable — treat as empty
      }
    }

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

