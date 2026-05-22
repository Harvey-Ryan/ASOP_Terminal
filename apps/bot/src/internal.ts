import http from 'node:http';
import { setupDiscordForEvent, endEvent, updatePostEventEmbed, updateRosterEmbed, syncDiscordEvent } from './services/eventService.js';
import { announceLootResults, notifySnakeTurn } from './services/lootService.js';
import { registerCommands } from './services/commandService.js';

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
      await updateRosterEmbed(eventId).catch((err) =>
        console.error(`[bot:internal] updateRosterEmbed failed for ${eventId}:`, err),
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

    if (req.url === '/trigger/register-commands') {
      res.writeHead(202).end();
      await registerCommands().catch((err) =>
        console.error('[bot:internal] registerCommands failed:', err),
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
