import http from 'node:http';
import { setupDiscordForEvent, endEvent } from './services/eventService.js';
import { announceLootResults } from './services/lootService.js';

const PORT = parseInt(process.env['BOT_INTERNAL_PORT'] ?? '3002');

export function startInternalServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }

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

    const lootMatch = req.url?.match(/^\/trigger\/loot\/([^/]+)$/);
    if (lootMatch) {
      const sessionId = lootMatch[1]!;
      res.writeHead(202).end();
      await announceLootResults(sessionId).catch((err) =>
        console.error(`[bot:internal] announceLootResults failed for ${sessionId}:`, err),
      );
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[bot] Internal server listening on 127.0.0.1:${PORT}`);
  });
}
