// "Your data" (v1.31.0): everything ASOP holds about one person, as a download,
// and deleting it. A new model that stores a person (a Discord id, our User
// id, a username) belongs in both exportMyData and deleteMyData.
//
// Deleting removes what is only theirs (logins, sign-ups to come, queues,
// fleet, pin, settings…) and anonymises what other people's records rely on
// (loot handed out, the DKP ledger, past attendance, auction results, trades
// with others, tournaments, jobs): their id becomes a one-off "deleted-…" id
// and their name "Deleted member". The User row stays as that tombstone, so
// nothing pointing at it breaks; signing in again makes a new one.

import { randomBytes } from 'node:crypto';
import { prisma } from './prisma.js';
import { lockEvent, fillFromWaitlist, announceWaitlistMoves } from './waitlist.js';
import { triggerBot } from './triggerBot.js';
import { parseTicked, type WaitlistMove } from '@dem/shared';

export const DELETED_NAME = 'Deleted member';

const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

/** Everything about one person, for the download. No secrets (tokens, calendar link). */
export async function exportMyData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const d = user.discordId;

  const [
    accounts, memberships, prefs, pins, templates,
    rsvps, waitlists, comments, eventsCreated, attended,
    lootWon, draftQueues, lootSessionsOwned, dkpBalances, dkpLedger,
    lootAuctionBids, lootAuctionsWon, auctionBids, auctionsStarted, auctionsWon,
    inventory, tradesAsBuyer, tradeMessages, fleetOwner, fleetShips,
    tournamentsCreated, tournamentEntries, teamSpots, ratings, standings,
    jobsPosted, jobCrew, briefings, wikelo, errors, requests,
  ] = await Promise.all([
    prisma.account.findMany({ where: { userId }, select: { provider: true, providerAccountId: true, scope: true, createdAt: true } }),
    prisma.guildMember.findMany({ where: { userId }, select: { role: true, rsiHandle: true, rsiVerified: true, createdAt: true, guild: { select: { guildId: true, name: true } } } }),
    prisma.userNotificationPrefs.findUnique({ where: { userId } }),
    prisma.memberPin.findMany({ where: { userId }, select: { municipality: true, lat: true, lng: true, displayName: true, timezone: true, createdAt: true, guild: { select: { guildId: true, name: true } } } }),
    prisma.eventTemplate.findMany({ where: { createdById: userId } }),
    prisma.eventRsvp.findMany({ where: { userId: d }, include: { event: { select: { name: true, startTime: true, guildId: true } } } }),
    prisma.eventWaitlist.findMany({ where: { userId: d } }),
    prisma.eventComment.findMany({ where: { userId: d } }),
    prisma.event.findMany({ where: { OR: [{ createdById: d }, { aarById: d }] }, select: { id: true, guildId: true, name: true, startTime: true, status: true, createdById: true, aarById: true, aarOutcome: true, aarNotes: true } }),
    prisma.event.findMany({ where: { OR: [{ vcAttendees: { contains: `"${d}"` } }, { confirmedAttendees: { contains: `"${d}"` } }] }, select: { id: true, guildId: true, name: true, startTime: true } }),
    prisma.lootAssignment.findMany({ where: { userId: d }, include: { item: { select: { name: true, quantity: true, session: { select: { guildId: true, name: true, eventId: true } } } } } }),
    prisma.lootDraftQueue.findMany({ where: { userId: d } }),
    prisma.lootSession.findMany({ where: { ownerId: d }, select: { id: true, guildId: true, name: true, method: true, status: true, createdAt: true } }),
    prisma.dkpBalance.findMany({ where: { userId: d } }),
    prisma.dkpTransaction.findMany({ where: { userId: d }, orderBy: { createdAt: 'asc' } }),
    prisma.lootAuctionBid.findMany({ where: { userId: d } }),
    prisma.lootAuction.findMany({ where: { winnerId: d }, select: { id: true, guildId: true, itemId: true, winningBid: true, closesAt: true } }),
    prisma.auctionBid.findMany({ where: { userId: d } }),
    prisma.auction.findMany({ where: { startedById: d }, select: { id: true, guildId: true, title: true, status: true, createdAt: true } }),
    prisma.auction.findMany({ where: { winnerId: d }, select: { id: true, guildId: true, title: true, winningBid: true, closesAt: true } }),
    prisma.inventoryEntry.findMany({ where: { userId: d } }),
    prisma.trade.findMany({ where: { buyerId: d } }),
    prisma.tradeMessage.findMany({ where: { senderId: d }, orderBy: { createdAt: 'asc' } }),
    prisma.fleetOwner.findUnique({ where: { discordId: d } }),
    prisma.fleetShip.findMany({ where: { discordId: d }, include: { ship: { select: { name: true, manufacturer: true } } } }),
    prisma.tournament.findMany({ where: { createdById: d }, select: { id: true, guildId: true, name: true, createdAt: true } }),
    prisma.tournamentParticipant.findMany({ where: { discordId: d }, select: { tournamentId: true, displayName: true, seed: true, status: true, placement: true, createdAt: true } }),
    prisma.tournamentTeamMember.findMany({ where: { discordId: d }, select: { participantId: true, displayName: true } }),
    prisma.tournamentPlayerRating.findMany({ where: { discordId: d }, include: { history: true } }),
    prisma.tournamentSeasonStanding.findMany({ where: { discordId: d } }),
    prisma.job.findMany({ where: { posterId: d }, select: { id: true, guildId: true, kind: true, title: true, details: true, reward: true, location: true, whenText: true, slots: true, visibility: true, status: true, createdAt: true } }),
    prisma.jobCrew.findMany({ where: { userId: d } }),
    prisma.eventBriefing.findMany({ where: { updatedBy: d }, select: { eventId: true, updatedAt: true, event: { select: { name: true } } } }),
    prisma.wikeloProgress.findMany({ where: { discordId: d }, select: { missionId: true, ticked: true, completedAt: true, updatedAt: true } }),
    prisma.errorEvent.findMany({ where: { userId: d }, select: { createdAt: true, source: true, message: true } }),
    prisma.requestLog.count({ where: { userId } }),
  ]);

  // Trades on their listings, with the whole conversation (it's theirs too).
  const tradesAsSeller = inventory.length
    ? await prisma.trade.findMany({ where: { inventoryEntryId: { in: inventory.map((i) => i.id) } } })
    : [];
  const tradeIds = [...new Set([...tradesAsBuyer, ...tradesAsSeller].map((t) => t.id))];
  const conversations = tradeIds.length
    ? await prisma.tradeMessage.findMany({ where: { tradeId: { in: tradeIds } }, orderBy: { createdAt: 'asc' }, select: { tradeId: true, senderUsername: true, body: true, createdAt: true } })
    : [];

  return {
    about: 'Everything ASOP Terminal holds about you, across every server. Things already posted in Discord, and activity counted by RoleCall, are not included.',
    exportedAt: new Date().toISOString(),
    profile: {
      discordId: user.discordId, username: user.username, globalName: user.globalName, avatar: user.avatar, email: user.email,
      rsiHandle: user.rsiHandle, calendarFeed: user.calendarToken ? 'on' : 'off', createdAt: user.createdAt, updatedAt: user.updatedAt,
    },
    logins: accounts,
    servers: memberships,
    notificationSettings: prefs,
    memberMapPins: pins,
    eventTemplates: templates,
    events: {
      signUps: rsvps.map(({ event, ...r }) => ({ ...r, eventName: event.name, eventStart: event.startTime, eventServer: event.guildId })),
      waitlists,
      comments,
      createdOrReported: eventsCreated,
      attended,
    },
    loot: {
      won: lootWon.map(({ item, ...a }) => ({ ...a, item: item.name, quantity: item.quantity, server: item.session.guildId, session: item.session.name, eventId: item.session.eventId })),
      draftQueues,
      sessionsYouRan: lootSessionsOwned,
      auctionBids: lootAuctionBids,
      auctionsWon: lootAuctionsWon,
    },
    dkp: { balances: dkpBalances, ledger: dkpLedger },
    auctions: { bids: auctionBids, started: auctionsStarted, won: auctionsWon },
    marketplace: {
      inventory,
      tradesAsBuyer: tradesAsBuyer.map((t) => ({ ...t, listingSnapshot: t.listingSnapshot })),
      tradesAsSeller,
      messagesYouSent: tradeMessages,
      conversations,
    },
    fleet: {
      checkedAt: fleetOwner?.checkedAt ?? null,
      hiddenInServers: fleetOwner ? JSON.parse(fleetOwner.hiddenGuildIds) : [],
      ships: fleetShips.map(({ ship, ...f }) => ({ ...f, ship: ship?.name ?? null, manufacturer: ship?.manufacturer ?? null })),
    },
    tournaments: { created: tournamentsCreated, entries: tournamentEntries, teamSpots, ratings, seasonStandings: standings },
    jobs: { posted: jobsPosted, crew: jobCrew },
    wikeloChecklists: wikelo.map((w) => ({ ...w, ticked: parseTicked(w.ticked) })),
    briefingsLastEditedByYou: briefings.map((b) => ({ eventId: b.eventId, event: b.event.name, updatedAt: b.updatedAt })),
    problemsLogged: { errors, websiteRequestsLogged: requests },
  };
}

export interface DeleteResult { pseudonym: string }

/**
 * Deletes or anonymises everything about one person (see the top of the
 * file). Runs in one transaction; Discord is told afterwards.
 */
export async function deleteMyData(userId: string): Promise<DeleteResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const d = user.discordId;
  const ghost = `deleted-${randomBytes(6).toString('hex')}`;
  const as = { userId: ghost, username: DELETED_NAME };
  const swapId = (s: string | null) => (s ? s.split(`"${d}"`).join(`"${ghost}"`) : s);
  const now = new Date();

  const moves: { eventId: string; moves: WaitlistMove[] }[] = [];
  const rosterEvents = new Set<string>();
  const jobsToSync: string[] = [];

  await prisma.$transaction(async (tx) => {
    // ── Events ──
    // Sign-ups and waitlist places for events still to come: removed, and the
    // freed slot offered to whoever is waiting. Past ones stay, anonymised.
    const upcoming = await tx.eventRsvp.findMany({
      where: { userId: d, event: { status: { in: ['PENDING', 'ACTIVE'] } } },
      select: { eventId: true },
    });
    const waiting = await tx.eventWaitlist.findMany({ where: { userId: d }, select: { eventId: true } });
    for (const eventId of new Set([...upcoming, ...waiting].map((r) => r.eventId))) {
      const locked = await lockEvent(tx, eventId);
      await tx.eventWaitlist.deleteMany({ where: { eventId, userId: d } });
      if (locked && (locked.status === 'PENDING' || locked.status === 'ACTIVE')) {
        await tx.eventRsvp.deleteMany({ where: { eventId, userId: d } });
        moves.push({ eventId, moves: await fillFromWaitlist(tx, eventId, locked) });
        rosterEvents.add(eventId);
      }
    }
    await tx.eventRsvp.updateMany({ where: { userId: d }, data: as });
    await tx.eventComment.deleteMany({ where: { userId: d } });
    await tx.event.updateMany({ where: { createdById: d }, data: { createdById: ghost } });
    await tx.event.updateMany({ where: { aarById: d }, data: { aarById: ghost, aarByName: DELETED_NAME } });
    const withLists = await tx.event.findMany({
      where: { OR: [{ vcAttendees: { contains: `"${d}"` } }, { confirmedAttendees: { contains: `"${d}"` } }, { pollData: { contains: `"${d}"` } }] },
      select: { id: true, vcAttendees: true, confirmedAttendees: true, pollData: true },
    });
    for (const e of withLists) {
      await tx.event.update({ where: { id: e.id }, data: { vcAttendees: swapId(e.vcAttendees)!, confirmedAttendees: swapId(e.confirmedAttendees), pollData: swapId(e.pollData) } });
    }

    // ── Loot and DKP ──
    await tx.lootDraftQueue.deleteMany({ where: { userId: d } });
    await tx.lootAssignment.updateMany({ where: { userId: d }, data: as });
    await tx.lootSession.updateMany({ where: { ownerId: d }, data: { ownerId: ghost } });
    const sessions = await tx.lootSession.findMany({
      where: { OR: [{ draftOrder: { contains: `"${d}"` } }, { participants: { contains: `"${d}"` } }] },
      select: { id: true, draftOrder: true, participants: true },
    });
    for (const s of sessions) {
      const participants = json<{ userId: string; username: string }[]>(s.participants, [])
        .map((p) => (p.userId === d ? { userId: ghost, username: DELETED_NAME } : p));
      await tx.lootSession.update({ where: { id: s.id }, data: { draftOrder: swapId(s.draftOrder)!, participants: JSON.stringify(participants) } });
    }
    await tx.lootAuctionBid.updateMany({ where: { userId: d }, data: as });
    await tx.lootAuction.updateMany({ where: { startedById: d }, data: { startedById: ghost } });
    await tx.lootAuction.updateMany({ where: { winnerId: d }, data: { winnerId: ghost, winnerUsername: DELETED_NAME } });
    await tx.dkpBalance.updateMany({ where: { userId: d }, data: as });
    await tx.dkpTransaction.updateMany({ where: { userId: d }, data: as });
    await tx.auctionBid.updateMany({ where: { userId: d }, data: as });
    await tx.auction.updateMany({ where: { startedById: d }, data: { startedById: ghost } });
    await tx.auction.updateMany({ where: { winnerId: d }, data: { winnerId: ghost, winnerUsername: DELETED_NAME } });

    // ── Marketplace ──
    // Listings nobody traded on go; ones with trades stay (the other side's
    // history), anonymised and off the market.
    const listings = await tx.inventoryEntry.findMany({ where: { userId: d }, select: { id: true, _count: { select: { trades: true } } } });
    const traded = listings.filter((l) => l._count.trades > 0).map((l) => l.id);
    await tx.inventoryEntry.deleteMany({ where: { userId: d, id: { notIn: traded } } });
    if (traded.length) await tx.inventoryEntry.updateMany({ where: { id: { in: traded } }, data: { ...as, forSale: false, memberActive: false } });
    await tx.trade.updateMany({ where: { buyerId: d }, data: { buyerId: ghost, buyerUsername: DELETED_NAME } });
    await tx.tradeMessage.updateMany({ where: { senderId: d }, data: { senderId: ghost, senderUsername: DELETED_NAME } });
    await tx.tradeMessageRead.deleteMany({ where: { userId: d } });

    // ── Fleet, tournaments, jobs ──
    await tx.fleetOwner.deleteMany({ where: { discordId: d } }); // its ships go with it
    await tx.wikeloProgress.deleteMany({ where: { discordId: d } });
    await tx.eventBriefing.updateMany({ where: { updatedBy: d }, data: { updatedBy: ghost } }); // the briefing is the server's
    await tx.tournament.updateMany({ where: { createdById: d }, data: { createdById: ghost } });
    await tx.tournamentParticipant.updateMany({ where: { discordId: d }, data: { discordId: ghost, displayName: DELETED_NAME } });
    await tx.tournamentTeamMember.updateMany({ where: { discordId: d }, data: { discordId: ghost, displayName: DELETED_NAME } });
    await tx.tournamentPlayerRating.updateMany({ where: { discordId: d }, data: { discordId: ghost, displayName: DELETED_NAME } });
    await tx.tournamentSeasonStanding.updateMany({ where: { discordId: d }, data: { discordId: ghost, displayName: DELETED_NAME } });

    const openJobs = await tx.job.findMany({ where: { posterId: d, status: 'OPEN' }, select: { id: true } });
    if (openJobs.length) await tx.job.updateMany({ where: { id: { in: openJobs.map((j) => j.id) } }, data: { status: 'CANCELLED', closedAt: now } });
    await tx.job.updateMany({ where: { posterId: d }, data: { posterId: ghost, posterName: DELETED_NAME } });
    const crewOpen = await tx.jobCrew.findMany({ where: { userId: d, job: { status: 'OPEN' } }, select: { id: true, jobId: true } });
    if (crewOpen.length) await tx.jobCrew.deleteMany({ where: { id: { in: crewOpen.map((c) => c.id) } } });
    await tx.jobCrew.updateMany({ where: { userId: d }, data: as });
    jobsToSync.push(...openJobs.map((j) => j.id), ...crewOpen.map((c) => c.jobId));

    // ── Logs ──
    await tx.errorEvent.updateMany({ where: { userId: d }, data: { userId: null } });
    await tx.requestLog.deleteMany({ where: { userId } });
    await tx.adminLog.updateMany({ where: { actorId: d }, data: { actorId: ghost, actorName: DELETED_NAME } });

    // ── The person ──
    await tx.account.deleteMany({ where: { userId } });
    await tx.guildMember.deleteMany({ where: { userId } });
    await tx.userNotificationPrefs.deleteMany({ where: { userId } });
    await tx.memberPin.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: { discordId: ghost, username: DELETED_NAME, discriminator: '0', globalName: null, avatar: null, email: null, rsiHandle: null, calendarToken: null },
    });
    // Signed out everywhere.
    await tx.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${userId}`;
  }, { timeout: 60_000, maxWait: 10_000 });

  for (const m of moves) announceWaitlistMoves(m.eventId, m.moves);
  for (const eventId of rosterEvents) triggerBot(`/trigger/rsvp/${eventId}`);
  for (const jobId of new Set(jobsToSync)) triggerBot(`/trigger/job/${jobId}`);
  return { pseudonym: ghost };
}
