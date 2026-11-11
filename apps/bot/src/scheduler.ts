import { expireJobs } from './services/jobService.js';
import cron from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { prisma } from './db.js';
import { client } from './client.js';
import { setupDiscordForEvent, setupDiscordForShare, endEvent, deleteEventVcs, createVcsForEvent, postEventLive, updatePostEventEmbed } from './services/eventService.js';
import { joinRoster } from './services/rsvpService.js';
import { closeExpiredAuctions, closeExpiredStandaloneAuctions } from './services/auctionService.js';
import { dispatchTournamentReminder, recordMatchForfeit } from './services/tournamentService.js';
import { formatMinutes } from './utils/time.js';
import { SETUP_MAX_ATTEMPTS, afterSetupAttempt } from './utils/setupRetry.js';
import { recordDeployment, refreshStatusEmbeds } from './services/statusService.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Like Promise.allSettled(items.map(fn)), but at most `limit` at a time; results keep their order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { status: 'fulfilled', value: await fn(items[i]!) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Two loops, each run every minute with its own guard (v1.11.1). The event
// lifecycle (going live, voice channels, ending, loot timeouts, auctions,
// tournament matches) is time-critical and quick; posting (Discord setup
// retries, reminders and their DMs, status embeds) can be slow when there's a
// lot to send. Before, one sequential tick ran both, so a burst of reminders
// could delay voice-channel creation, and a tick running over a minute made
// the next one skip everything. A loop still never overlaps itself.
const running = { lifecycle: false, posting: false };

export async function runLoop(name: keyof typeof running, checks: [string, () => Promise<void>][]): Promise<void> {
  if (running[name]) {
    console.warn(`[bot] ${name} tick skipped — previous one still running (possible Discord rate-limit or slow query)`);
    return;
  }
  running[name] = true;
  try {
    for (const [label, fn] of checks) await timedCheck(label, fn);
  } finally {
    running[name] = false;
  }
}

const LIFECYCLE_CHECKS: [string, () => Promise<void>][] = [
  ['checkEventStart',                checkEventStart],
  ['checkVcCreation',                checkVcCreation],
  ['checkVcActivity',                checkVcActivity],
  ['checkInactivityEnd',             checkInactivityEnd],
  ['checkStuckActiveEvents',         checkStuckActiveEvents],
  ['checkEventEnd',                  checkEventEnd],
  ['checkEndedEvents',               checkEndedEvents],
  ['checkLootPromptTimeout',         checkLootPromptTimeout],
  ['checkAutoComplete',              checkAutoComplete],
  ['closeExpiredAuctions',           closeExpiredAuctions],
  ['expireJobs',                     expireJobs],
  ['closeExpiredStandaloneAuctions', closeExpiredStandaloneAuctions],
  ['checkMatchCheckIn',              checkMatchCheckIn],
  ['checkMatchNoShow',               checkMatchNoShow],
  ['checkMatchNoShowEscalation',     checkMatchNoShowEscalation],
];

const POSTING_CHECKS: [string, () => Promise<void>][] = [
  ['checkPendingDiscordSetup', checkPendingDiscordSetup],
  ['checkPendingShareSetup',   checkPendingShareSetup],
  ['checkReminders',           checkReminders],
  ['checkTournamentReminders', checkTournamentReminders],
  ['refreshStatusEmbeds',      () => refreshStatusEmbeds()],
];

// Runs a named scheduler check, logs its duration, and swallows errors so one
// failing check never blocks the rest of the tick.
async function timedCheck(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
  } catch (e) {
    console.error(`[bot] ${name} error:`, e);
  } finally {
    const ms = Date.now() - start;
    if (ms > 5_000) {
      console.warn(`[bot] ${name} took ${ms}ms — possible Discord rate-limit or slow query`);
    }
  }
}

export async function startScheduler() {
  await recordDeployment();

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
    // Two at a time (v1.11.1): a restart with many upcoming events used to fire
    // three Discord requests per event all at once.
    const results = await mapLimit(
      activeEvents.filter((e) => e.discordEventId),
      2,
      async (event) => {
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
            await joinRoster(event.id, sub.user.id, username, event.guildId).catch((err) =>
              console.error(`[bot] Startup sync: joinRoster failed for ${sub.user.id}:`, err),
            );
            count++;
          }
          return count;
      },
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

  // Recover VCs for ACTIVE events that started within the last 2 hours but have
  // no VCs yet. This handles the case where the bot restarted mid-event: the
  // checkVcCreation cron only looks forward (startTime >= now), so it never fires
  // for an event whose start time is already in the past.
  // The 2-hour cap avoids creating VCs for old no-VC events (e.g. text-only events
  // that checkStuckActiveEvents will eventually clean up).
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    const missingVcs = await prisma.event.findMany({
      where: {
        status: 'ACTIVE',
        vcIds: '[]',
        startTime: { gte: twoHoursAgo, lte: new Date() },
      },
    });
    if (missingVcs.length > 0) {
      console.log(`[bot] Startup VC recovery: found ${missingVcs.length} ACTIVE event(s) with no VCs — creating now`);
      const vcResults = await mapLimit(missingVcs, 2, (event) =>
        createVcsForEvent(event.id).catch((err) =>
          console.error(`[bot] Startup VC recovery failed for event ${event.id}:`, err),
        ),
      );
      const created = vcResults.filter((r) => r.status === 'fulfilled').length;
      console.log(`[bot] Startup VC recovery: created VCs for ${created}/${missingVcs.length} event(s)`);
    }
  } catch (err) {
    console.error('[bot] Startup VC recovery failed:', err);
  }

  cron.schedule('* * * * *', () => {
    // Independent: a slow posting run never holds up the lifecycle.
    void runLoop('lifecycle', LIFECYCLE_CHECKS);
    void runLoop('posting', POSTING_CHECKS);
  });
  console.log('[bot] Scheduler started');
}

// ── "Event is live" announcement at start time ────────────────────────────────

export async function checkEventStart() {
  const now = new Date();

  // Auto-transition PENDING events whose start time has arrived. An event
  // without a forum thread waits 15 minutes for setup to catch up, then goes
  // live anyway (v1.11.1; before, it stayed PENDING forever). Setup retries
  // still cover ACTIVE events.
  const transitioned = await prisma.event.updateMany({
    where: {
      status: 'PENDING',
      startTime: { lte: now },
      OR: [{ threadId: { not: null } }, { startTime: { lte: new Date(now.getTime() - 15 * 60_000) } }],
    },
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

export async function checkPendingDiscordSetup() {
  // Events whose Discord setup didn't finish: no forum thread yet, or no
  // Discord event while it's still upcoming (one can't be made for the past).
  // Each gets a few attempts with growing gaps (utils/setupRetry.ts), and items
  // that keep failing never block newer ones. A changed forum channel setting
  // resets the count (API settings route).
  const now = new Date();
  const pending = await prisma.event.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      OR: [{ threadId: null }, { discordEventId: null, startTime: { gt: now } }],
      setupAttempts: { lt: SETUP_MAX_ATTEMPTS },
      AND: [{ OR: [{ nextSetupAt: null }, { nextSetupAt: { lte: now } }] }],
    },
    orderBy: [{ nextSetupAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: 5,
  });
  for (const event of pending) {
    await setupDiscordForEvent(event.id).catch((err) =>
      console.error(`[bot] Discord setup failed for event ${event.id}:`, err),
    );
    const after = await prisma.event.findUnique({ where: { id: event.id }, select: { threadId: true, discordEventId: true, startTime: true } });
    if (!after) continue;
    const done = !!after.threadId && (!!after.discordEventId || after.startTime <= new Date());
    const next = afterSetupAttempt(done, event.setupAttempts, new Date());
    if (done && event.setupAttempts === 0) continue; // nothing to record
    await prisma.event.update({ where: { id: event.id }, data: { setupAttempts: next.setupAttempts, nextSetupAt: next.nextSetupAt } });
    if (next.gaveUp) {
      console.warn(`[bot] Giving up on Discord setup for event ${event.id} (${event.name}) in ${event.guildId} after ${next.setupAttempts} attempts — `
        + `is a forum channel set and can the bot post there? Changing the forum channel setting retries it.`);
    }
  }
}

// ── Reminder dispatch ─────────────────────────────────────────────────────────

async function checkReminders() {
  // take: 20 prevents a reminder flood on restart when many past-due rows accumulate.
  const due = await prisma.eventReminder.findMany({
    where: { sent: false, sendAt: { lte: new Date() } },
    include: { event: { include: { rsvps: true } } },
    take: 20,
  });

  for (const reminder of due) {
    const { event } = reminder;
    const minsLeft = Math.round((event.startTime.getTime() - Date.now()) / 60_000);
    const when = minsLeft > 0 ? `in ${formatMinutes(minsLeft)}` : 'now';
    const ts = Math.floor(event.startTime.getTime() / 1000);

    if (reminder.type === 'FORUM') {
      // ── Host guild thread ───────────────────────────────────────────────────
      if (event.threadId) {
        try {
          const thread = await client.channels.fetch(event.threadId);
          if (thread?.isThread()) {
            await thread.send(`⏰ **Reminder:** **${event.name}** starts ${when}! (<t:${ts}:F>)`);
          }
        } catch (err) {
          console.error(`[bot] Forum reminder failed for event ${event.id}:`, err);
        }
      }

      // ── Alliance guild threads (fan-out) ────────────────────────────────────
      // One after another. Each thread is its own rate-limit bucket and
      // discord.js already queues per bucket, so no manual wait is needed
      // (it only held up the rest of the posting loop).
      const agReminders = await prisma.eventAllianceGuild.findMany({
        where: { eventId: event.id, threadId: { not: null } },
      });
      for (const ag of agReminders) {
        try {
          const agThread = await client.channels.fetch(ag.threadId!);
          if (agThread?.isThread()) {
            await agThread.send(`⏰ **Reminder:** **${event.name}** starts ${when}! (<t:${ts}:F>)`);
          }
        } catch (err) {
          console.error(`[bot] Forum reminder failed for alliance guild ${ag.discordGuildId} (event ${event.id}):`, err);
        }
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

      // Send DMs in chunks of 5 with a 1 s gap between chunks to avoid saturating
      // the bot's global rate limit on a large-roster event (50+ members at once).
      const DM_CHUNK = 5;
      const dmResults: PromiseSettledResult<void>[] = [];
      for (let i = 0; i < dmTargets.length; i += DM_CHUNK) {
        if (i > 0) await sleep(1_000);
        const chunk = dmTargets.slice(i, i + DM_CHUNK);
        const chunkResults = await Promise.allSettled(
          chunk.map(async (rsvp) => {
            const user = await client.users.fetch(rsvp.userId);
            await user.send(
              `${event.name} starts in 15 minutes! ${rsvp.tentative ? 'You said maybe; if you can make it, join a voice channel to participate.' : 'Join a voice channel to participate.'}\nMuster Point: ${event.musterPoint ?? 'See event details'}${notifFooter}`,
            );
          }),
        );
        dmResults.push(...chunkResults);
      }

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

// ── Safety net: end ACTIVE events with no VCs and no endTime running > 24h ───
// These events have no automated exit path (VC inactivity requires VCs;
// checkEventEnd requires endTime), so they would run forever without this.

async function checkStuckActiveEvents() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const stuck = await prisma.event.updateMany({
    where: {
      status: 'ACTIVE',
      startTime: { lte: cutoff },
      endTime: null,
      vcIds: '[]',
    },
    data: { status: 'ENDED' },
  });
  if (stuck.count > 0) {
    console.log(`[bot] Transitioned ${stuck.count} stuck ACTIVE event(s) → ENDED (no VCs, no endTime, >24h)`);
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
  // Use botEndedAt (not endTime) as the 24h grace-period timer — this covers events
  // ended by VC inactivity or the stuck-event safety net that have no endTime set.
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const events = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      botCleanedUp: true,
      botEndedAt: { not: null, lte: cutoff },
    },
    take: 5,
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

    // Post a notice in the event thread so guild members know the event was finalised
    if (event.threadId) {
      try {
        const thread = await client.channels.fetch(event.threadId).catch(() => null);
        if (thread?.isThread()) {
          if (thread.archived) await thread.setArchived(false).catch(() => null);
          await thread.send('✅ This event has been automatically completed after the 24-hour review period.');
          await thread.setArchived(true).catch(() => null);
        }
      } catch (err) {
        console.error(`[bot] Failed to post auto-complete notice for event ${event.id}:`, err);
      }
    }

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

// ── Auto-resolve the loot/no-loot prompt after 2 hours of no response ────────
// Protects against the prompt being permanently open when the event creator
// is absent. Sets hadLoot=false and archives all threads.

async function checkLootPromptTimeout() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);

  const events = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      botEndedAt: { not: null, lte: twoHoursAgo },
      hadLoot: null,   // prompt never answered
    },
    take: 5,
  });

  for (const event of events) {
    // If a loot session already exists the admin started loot via the dashboard but
    // hadn't clicked the Discord button yet. Correct the flag and move on — never
    // archive a thread while a live loot session is running.
    const existingSession = await prisma.lootSession.findUnique({
      where: { eventId: event.id },
      select: { id: true },
    });
    if (existingSession) {
      await prisma.event.updateMany({
        where: { id: event.id, hadLoot: null },
        data: { hadLoot: true },
      });
      console.log(`[bot] checkLootPromptTimeout: event ${event.id} has an active loot session — correcting hadLoot to true`);
      continue;
    }

    // Atomic claim — guard against concurrent scheduler ticks or restarts
    const claimed = await prisma.event.updateMany({
      where: { id: event.id, hadLoot: null },
      data: { hadLoot: false },
    });
    if (claimed.count === 0) continue; // another process already claimed it

    console.log(`[bot] checkLootPromptTimeout: auto-resolving event ${event.id} (${event.name}) as no loot`);

    // Archive host thread
    if (event.threadId) {
      try {
        const thread = await client.channels.fetch(event.threadId).catch(() => null);
        if (thread?.isThread()) {
          if (thread.archived) await thread.setArchived(false).catch(() => null);
          await thread.send('⏰ Loot prompt expired — event closed with no loot.').catch(() => null);
          await thread.setArchived(true).catch(() => null);
        }
      } catch (err) {
        console.error(`[bot] checkLootPromptTimeout: failed to archive host thread for event ${event.id}:`, err);
      }
    }

    // Archive alliance guild threads
    const allianceGuilds = await prisma.eventAllianceGuild.findMany({
      where: { eventId: event.id, threadId: { not: null } },
    });
    await Promise.allSettled(
      allianceGuilds.map(async (ag) => {
        try {
          const thread = await client.channels.fetch(ag.threadId!).catch(() => null);
          if (!thread?.isThread()) return;
          if (thread.archived) await thread.setArchived(false).catch(() => null);
          await thread.send('⏰ Loot prompt expired — event closed with no loot.').catch(() => null);
          await thread.setArchived(true).catch(() => null);
        } catch (err) {
          console.error(`[bot] checkLootPromptTimeout: failed to archive alliance thread for guild ${ag.discordGuildId}:`, err);
        }
      }),
    );
  }
}

// ── Retry Discord setup for accepted shares where the bot never ran ───────────
// Covers the case where a guild accepted an event invite but the bot was down or
// the trigger HTTP call timed out, leaving the share ACCEPTED but no
// EventAllianceGuild record created (no forum thread / scheduled event posted).
//
// Detection: the EventAllianceGuild.shareId FK means a null `allianceGuild` relation
// on an ACCEPTED share == no setup has ever been attempted via the new code path.
// Legacy rows (created before shareId was added) get their shareId backfilled on the
// first successful call to setupDiscordForShare, so they stop appearing here.

export async function checkPendingShareSetup() {
  const now = new Date();
  const orphaned = await prisma.eventGuildShare.findMany({
    where: {
      status: 'ACCEPTED',
      allianceGuild: null,                          // no linked EventAllianceGuild yet
      event: { status: { notIn: ['COMPLETED', 'ENDED', 'CANCELLED'] } },
      setupAttempts: { lt: SETUP_MAX_ATTEMPTS },
      OR: [{ nextSetupAt: null }, { nextSetupAt: { lte: now } }],
    },
    take: 5,                                        // cap per tick to avoid Discord rate-limits
    orderBy: [{ nextSetupAt: { sort: 'asc', nulls: 'first' } }, { invitedAt: 'asc' }],
  });

  for (const share of orphaned) {
    console.log(`[bot] checkPendingShareSetup: retrying Discord setup for share ${share.id}`);
    await setupDiscordForShare(share.id).catch((err) =>
      console.error(`[bot] checkPendingShareSetup: setup failed for share ${share.id}:`, err),
    );
    const done = (await prisma.eventAllianceGuild.count({ where: { shareId: share.id } })) > 0;
    const next = afterSetupAttempt(done, share.setupAttempts, new Date());
    if (done && share.setupAttempts === 0) continue;
    await prisma.eventGuildShare.update({ where: { id: share.id }, data: { setupAttempts: next.setupAttempts, nextSetupAt: next.nextSetupAt } });
    if (next.gaveUp) {
      console.warn(`[bot] Giving up on posting share ${share.id} (event ${share.eventId}) after ${next.setupAttempts} attempts — is the bot still in that server?`);
    }
  }
}

// ── Tournament reminder dispatch ──────────────────────────────────────────────

async function checkTournamentReminders() {
  const due = await prisma.tournamentReminder.findMany({
    where: { sentAt: null, scheduledAt: { lte: new Date() } },
    take: 20,
  });
  for (const reminder of due) {
    await dispatchTournamentReminder(reminder.id).catch((err) =>
      console.error(`[bot] Tournament reminder dispatch failed for ${reminder.id}:`, err),
    );
  }
}

// ── Check-in prompt (15 min before scheduled match) ──────────────────────────

async function checkMatchCheckIn() {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);
  const matches = await prisma.tournamentMatch.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: new Date(), gte: fifteenMinAgo },
    },
    take: 10,
  });

  for (const match of matches) {
    if (!match.checkedInA || !match.checkedInB) {
      // Transition to READY_CHECK and ensure the check-in reminder fired
      await prisma.tournamentMatch.update({
        where: { id: match.id },
        data: { status: 'READY_CHECK' },
      }).catch(() => null);
    }
  }
}

// ── No-show detection (30 min past scheduled time) ───────────────────────────

async function checkMatchNoShow() {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
  const stuck = await prisma.tournamentMatch.findMany({
    where: {
      status: { in: ['SCHEDULED', 'READY_CHECK'] },
      scheduledAt: { lte: thirtyMinAgo },
      resultPostedAt: null,
    },
    include: { tournament: true, participantA: true, participantB: true },
    take: 5,
  });

  for (const match of stuck) {
    if (!match.tournament.threadId) continue;
    const thread = await client.channels.fetch(match.tournament.threadId).catch(() => null);
    if (!thread?.isThread()) continue;

    // Determine no-show side(s)
    const noShowA = !match.checkedInA ? match.participantA : null;
    const noShowB = !match.checkedInB ? match.participantB : null;
    const noShowNames = [noShowA?.displayName, noShowB?.displayName].filter(Boolean).join(' and ');

    await thread.send(
      `⚠️ **No-show alert** — Round ${match.round} Match ${match.position + 1}: ${noShowNames} has not checked in 30 minutes after the scheduled time. A manager must manually record the result or forfeit.`,
    ).catch(() => null);

    // Transition to AWAITING_RESULT so this doesn't re-fire
    await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: { status: 'AWAITING_RESULT' },
    }).catch(() => null);
  }
}

// ── No-show escalation (2 hours past scheduled time) ─────────────────────────
//
// If one side checked in and the other didn't, the checked-in participant is
// almost certainly the winner — post a manager-clickable "Record Forfeit" button.
// If neither side checked in, post an urgent follow-up asking the manager to act.
// The `noShowEscalatedAt` field on the match prevents this from firing repeatedly.

async function checkMatchNoShowEscalation() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
  const stuck = await prisma.tournamentMatch.findMany({
    where: {
      status: 'AWAITING_RESULT',
      scheduledAt: { lte: twoHoursAgo },
      resultPostedAt: null,
      noShowEscalatedAt: null,
    },
    include: { tournament: true, participantA: true, participantB: true },
    take: 5,
  });

  for (const match of stuck) {
    if (!match.tournament.threadId) continue;
    const thread = await client.channels.fetch(match.tournament.threadId).catch(() => null);
    if (!thread?.isThread()) continue;

    const roundLabel = `Round ${match.round} Match ${match.position + 1}`;
    const checkedInA = match.checkedInA ? match.participantA : null;
    const checkedInB = match.checkedInB ? match.participantB : null;
    const noShowA    = !match.checkedInA ? match.participantA : null;
    const noShowB    = !match.checkedInB ? match.participantB : null;

    // One side confirmed, one is a no-show — offer managers the auto-forfeit button
    if ((checkedInA || checkedInB) && (noShowA || noShowB)) {
      const winner   = (checkedInA ?? checkedInB)!;
      const noShow   = (noShowA   ?? noShowB)!;

      const forfeitRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`bracket_autoforfeit:${match.id}:${winner.id}`)
          .setLabel(`⚖️ Record Forfeit — ${winner.displayName.slice(0, 24)} wins`)
          .setStyle(ButtonStyle.Danger),
      );

      await thread.send({
        content: `🔴 **Escalation — ${roundLabel}:** It has been 2 hours since the scheduled time.\n**${noShow.displayName}** has not checked in. **${winner.displayName}** was present and ready.\n\n_Managers: click below to record a forfeit win for ${winner.displayName}. If this is the final match, mark the tournament complete via the dashboard afterwards._`,
        components: [forfeitRow],
      }).catch(() => null);

    } else {
      // Neither side checked in — require manual manager action
      const nameA = match.participantA?.displayName ?? '?';
      const nameB = match.participantB?.displayName ?? '?';

      await thread.send(
        `🔴 **Escalation — ${roundLabel}:** It has been 2 hours since the scheduled time and **neither ${nameA} nor ${nameB} checked in**. A manager must manually record the result, record a forfeit via the dashboard, or contact both participants. If this was the final match, mark the tournament complete via the dashboard once resolved.`,
      ).catch(() => null);
    }

    // Mark escalated so this match won't fire again
    await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: { noShowEscalatedAt: new Date() },
    }).catch(() => null);
  }
}

