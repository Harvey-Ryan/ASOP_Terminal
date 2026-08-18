import http from 'node:http';
import { setupDiscordForEvent, endEvent, updatePostEventEmbed, syncDiscordEvent, createVcsForEvent, postEventLive, setupDiscordForShare, revokeDiscordShare } from './services/eventService.js';
import { announceLootResults, announceLootSessionStart, notifySnakeTurn, notifyStandaloneSnakeTurn, announceDraftOrder, notifyLootComplete } from './services/lootService.js';
import { postOrUpdateAuctionMessage, postOrUpdateStandaloneAuctionMessage } from './services/auctionService.js';
import { registerCommands } from './services/commandService.js';
import { queueRosterUpdate, notifyThreadJoin } from './services/rsvpService.js';
import { setupDiscordForTournament, postMatchResult, postTournamentOpen, postTournamentComplete, addParticipantToThread } from './services/tournamentService.js';

const PORT = parseInt(process.env['BOT_INTERNAL_PORT'] ?? '3002');

const INTERNAL_SECRET = process.env['BOT_INTERNAL_SECRET'];

export function startInternalServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }

    if (INTERNAL_SECRET) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${INTERNAL_SECRET}`) { res.writeHead(401).end(); return; }
    }

    const setupMatch = req.url?.match(/^\/trigger\/event\/([^/]+)$/);
    if (setupMatch) {
      const eventId = setupMatch[1]!;
      res.writeHead(202).end();
      await setupDiscordForEvent(eventId).catch((err) =>
        console.error(`[bot:internal] setupDiscordForEvent failed for ${eventId}:`, err),
      );
      return;
    }

    const endMatch = req.url?.match(/^\/trigger\/end\/([^/]+)$/);
    if (endMatch) {
      const eventId = endMatch[1]!;
      res.writeHead(202).end();
      await endEvent(eventId).catch((err) =>
        console.error(`[bot:internal] endEvent failed for ${eventId}:`, err),
      );
      return;
    }

    const completeMatch = req.url?.match(/^\/trigger\/complete\/([^/]+)$/);
    if (completeMatch) {
      const eventId = completeMatch[1]!;
      res.writeHead(202).end();
      await updatePostEventEmbed(eventId).catch((err) =>
        console.error(`[bot:internal] updatePostEventEmbed failed for ${eventId}:`, err),
      );
      return;
    }

    const syncMatch = req.url?.match(/^\/trigger\/sync\/([^/]+)$/);
    if (syncMatch) {
      const eventId = syncMatch[1]!;
      res.writeHead(202).end();
      await syncDiscordEvent(eventId).catch((err) =>
        console.error(`[bot:internal] syncDiscordEvent failed for ${eventId}:`, err),
      );
      return;
    }

    const rsvpMatch = req.url?.match(/^\/trigger\/rsvp\/([^/]+)$/);
    if (rsvpMatch) {
      const eventId = rsvpMatch[1]!;
      res.writeHead(202).end();
      await queueRosterUpdate(eventId).catch((err) =>
        console.error(`[bot:internal] queueRosterUpdate failed for ${eventId}:`, err),
      );
      return;
    }

    // Fired by the API when a web-dashboard RSVP creates a *new* roster entry.
    // Adds the member to the event thread and posts a "👋 joined" notification.
    const rsvpJoinMatch = req.url?.match(/^\/trigger\/rsvp-join\/([^/]+)\/([^/]+)$/);
    if (rsvpJoinMatch) {
      const [, eventId, userId] = rsvpJoinMatch as [string, string, string];
      res.writeHead(202).end();
      await notifyThreadJoin(eventId, userId).catch((err) =>
        console.error(`[bot:internal] notifyThreadJoin failed for event ${eventId} user ${userId}:`, err),
      );
      return;
    }

    const draftOrderMatch = req.url?.match(/^\/trigger\/draft-order\/([^/]+)$/);
    if (draftOrderMatch) {
      const eventId = draftOrderMatch[1]!;
      res.writeHead(202).end();
      await announceDraftOrder(eventId).catch((err) =>
        console.error(`[bot:internal] announceDraftOrder failed for ${eventId}:`, err),
      );
      return;
    }

    const lootSessionStartMatch = req.url?.match(/^\/trigger\/loot-session-start\/([^/]+)$/);
    if (lootSessionStartMatch) {
      const sessionId = lootSessionStartMatch[1]!;
      res.writeHead(202).end();
      await announceLootSessionStart(sessionId).catch((err) =>
        console.error(`[bot:internal] announceLootSessionStart failed for ${sessionId}:`, err),
      );
      return;
    }

    const lootMatch = req.url?.match(/^\/trigger\/loot\/([^/]+)$/);
    if (lootMatch) {
      const sessionId = lootMatch[1]!;
      res.writeHead(202).end();
      await announceLootResults(sessionId).catch((err) =>
        console.error(`[bot:internal] announceLootResults failed for ${sessionId}:`, err),
      );
      return;
    }

    const snakeTurnMatch = req.url?.match(/^\/trigger\/snake-turn\/([^/]+)$/);
    if (snakeTurnMatch) {
      const eventId = snakeTurnMatch[1]!;
      res.writeHead(202).end();
      await notifySnakeTurn(eventId).catch((err) =>
        console.error(`[bot:internal] notifySnakeTurn failed for ${eventId}:`, err),
      );
      return;
    }

    const standaloneSnakeTurnMatch = req.url?.match(/^\/trigger\/standalone-snake-turn\/([^/]+)$/);
    if (standaloneSnakeTurnMatch) {
      const sessionId = standaloneSnakeTurnMatch[1]!;
      res.writeHead(202).end();
      await notifyStandaloneSnakeTurn(sessionId).catch((err) =>
        console.error(`[bot:internal] notifyStandaloneSnakeTurn failed for ${sessionId}:`, err),
      );
      return;
    }

    const lootCompleteMatch = req.url?.match(/^\/trigger\/loot-complete\/([^/]+)$/);
    if (lootCompleteMatch) {
      const sessionId = lootCompleteMatch[1]!;
      res.writeHead(202).end();
      await notifyLootComplete(sessionId).catch((err) =>
        console.error(`[bot:internal] notifyLootComplete failed for ${sessionId}:`, err),
      );
      return;
    }

    const startMatch = req.url?.match(/^\/trigger\/start\/([^/]+)$/);
    if (startMatch) {
      const eventId = startMatch[1]!;
      res.writeHead(202).end();
      await postEventLive(eventId).catch((err) =>
        console.error(`[bot:internal] postEventLive (force-start) failed for ${eventId}:`, err),
      );
      return;
    }

    const shareAcceptedMatch = req.url?.match(/^\/trigger\/share-accepted\/([^/]+)$/);
    if (shareAcceptedMatch) {
      const shareId = shareAcceptedMatch[1]!;
      res.writeHead(202).end();
      await setupDiscordForShare(shareId).catch((err) =>
        console.error(`[bot:internal] setupDiscordForShare failed for ${shareId}:`, err),
      );
      return;
    }

    const shareRevokedMatch = req.url?.match(/^\/trigger\/share-revoked\/([^/]+)$/);
    if (shareRevokedMatch) {
      const shareId = shareRevokedMatch[1]!;
      res.writeHead(202).end();
      await revokeDiscordShare(shareId).catch((err) =>
        console.error(`[bot:internal] revokeDiscordShare failed for ${shareId}:`, err),
      );
      return;
    }

    const createVcsMatch = req.url?.match(/^\/trigger\/create-vcs\/([^/]+)$/);
    if (createVcsMatch) {
      const eventId = createVcsMatch[1]!;
      res.writeHead(202).end();
      await createVcsForEvent(eventId).catch((err) =>
        console.error(`[bot:internal] createVcsForEvent failed for ${eventId}:`, err),
      );
      return;
    }

    const auctionStartMatch = req.url?.match(/^\/trigger\/auction-start\/([^/]+)$/);
    if (auctionStartMatch) {
      const auctionId = auctionStartMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateAuctionMessage (start) failed for ${auctionId}:`, err),
      );
      return;
    }

    const auctionBidMatch = req.url?.match(/^\/trigger\/auction-bid\/([^/]+)$/);
    if (auctionBidMatch) {
      const auctionId = auctionBidMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateAuctionMessage (bid) failed for ${auctionId}:`, err),
      );
      return;
    }

    const auctionCloseMatch = req.url?.match(/^\/trigger\/auction-close\/([^/]+)$/);
    if (auctionCloseMatch) {
      const auctionId = auctionCloseMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateAuctionMessage (close) failed for ${auctionId}:`, err),
      );
      return;
    }

    const standaloneAuctionStartMatch = req.url?.match(/^\/trigger\/standalone-auction-start\/([^/]+)$/);
    if (standaloneAuctionStartMatch) {
      const auctionId = standaloneAuctionStartMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateStandaloneAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateStandaloneAuctionMessage (start) failed for ${auctionId}:`, err),
      );
      return;
    }

    const standaloneAuctionBidMatch = req.url?.match(/^\/trigger\/standalone-auction-bid\/([^/]+)$/);
    if (standaloneAuctionBidMatch) {
      const auctionId = standaloneAuctionBidMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateStandaloneAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateStandaloneAuctionMessage (bid) failed for ${auctionId}:`, err),
      );
      return;
    }

    const standaloneAuctionCloseMatch = req.url?.match(/^\/trigger\/standalone-auction-close\/([^/]+)$/);
    if (standaloneAuctionCloseMatch) {
      const auctionId = standaloneAuctionCloseMatch[1]!;
      res.writeHead(202).end();
      await postOrUpdateStandaloneAuctionMessage(auctionId).catch((err) =>
        console.error(`[bot:internal] postOrUpdateStandaloneAuctionMessage (close) failed for ${auctionId}:`, err),
      );
      return;
    }

    if (req.url === '/trigger/register-commands') {
      res.writeHead(202).end();
      await registerCommands().catch((err) =>
        console.error('[bot:internal] registerCommands failed:', err),
      );
      return;
    }

    const tournamentStartMatch = req.url?.match(/^\/trigger\/tournament-start\/([^/]+)$/);
    if (tournamentStartMatch) {
      const tournamentId = tournamentStartMatch[1]!;
      res.writeHead(202).end();
      await setupDiscordForTournament(tournamentId).catch((err) =>
        console.error(`[bot:internal] setupDiscordForTournament failed for ${tournamentId}:`, err),
      );
      return;
    }

    const tournamentOpenMatch = req.url?.match(/^\/trigger\/tournament-open\/([^/]+)$/);
    if (tournamentOpenMatch) {
      const tournamentId = tournamentOpenMatch[1]!;
      res.writeHead(202).end();
      await postTournamentOpen(tournamentId).catch((err) =>
        console.error(`[bot:internal] postTournamentOpen failed for ${tournamentId}:`, err),
      );
      return;
    }

    const tournamentMatchResultMatch = req.url?.match(/^\/trigger\/tournament-match-result\/([^/]+)$/);
    if (tournamentMatchResultMatch) {
      const matchId = tournamentMatchResultMatch[1]!;
      res.writeHead(202).end();
      await postMatchResult(matchId).catch((err) =>
        console.error(`[bot:internal] postMatchResult failed for ${matchId}:`, err),
      );
      return;
    }

    const tournamentCompleteMatch = req.url?.match(/^\/trigger\/tournament-complete\/([^/]+)$/);
    if (tournamentCompleteMatch) {
      const tournamentId = tournamentCompleteMatch[1]!;
      res.writeHead(202).end();
      await postTournamentComplete(tournamentId).catch((err) =>
        console.error(`[bot:internal] postTournamentComplete failed for ${tournamentId}:`, err),
      );
      return;
    }

    const tournamentParticipantMatch = req.url?.match(/^\/trigger\/tournament-participant-joined\/([^/]+)\/([^/]+)$/);
    if (tournamentParticipantMatch) {
      const tournamentId = tournamentParticipantMatch[1]!;
      const discordId = tournamentParticipantMatch[2]!;
      res.writeHead(202).end();
      await addParticipantToThread(tournamentId, discordId).catch((err) =>
        console.error(`[bot:internal] addParticipantToThread failed for ${tournamentId}/${discordId}:`, err),
      );
      return;
    }

    res.writeHead(404).end();
  });

  // Bind to 0.0.0.0 so Railway's private network can reach this from the API service
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[bot] Internal server listening on 0.0.0.0:${PORT}`);
  });
}
