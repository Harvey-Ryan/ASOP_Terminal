import 'dotenv/config';
import { refreshShipCatalog } from './lib/shipCatalog.js';
import { migrateOldFleets } from './lib/fleetMigration.js';
import cron from 'node-cron';
import { createServer } from './server/app.js';
import { runUexSync } from './lib/uexSync.js';
import { getCraftingPayload } from './lib/craftingData.js';
import { linkInventoryOnStartup } from './lib/catalog.js';
import { prisma } from './lib/prisma.js';
import { apiHeartbeat, captureApiConsole, flushErrors, pruneOldErrors } from './lib/errorLog.js';

// Errors and warnings logged from here on are also stored for the admin panel (v1.13.0).
captureApiConsole();

const isProd = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── Required env var checks ────────────────────────────────────────────────

const REQUIRED_PROD = ['SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'DISCORD_TOKEN'];
const REQUIRED_DEV  = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];

if (isProd) {
  const missing = REQUIRED_PROD.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[API] FATAL: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
} else {
  const missing = REQUIRED_DEV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`[API] OAuth env vars not set: ${missing.join(', ')}`);
    console.warn('[API] Copy apps/api/.env.example → .env and fill them in to enable login');
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('[API] SESSION_SECRET is not set — using insecure default (dev only)');
  }
}

// A failed background job (a timer, a cron run, a fire-and-forget call) is
// logged instead of stopping the API and the bot with it (v1.11.3). Request
// errors are handled in server/app.ts.
process.on('unhandledRejection', (err) => console.error('[API] Unhandled rejection:', err));
// Errors waiting to be written are saved before a deploy stops the process.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void flushErrors().finally(() => process.exit(0)); });
}

const app = createServer();

// ── UEX Corp weekly sync ───────────────────────────────────────────────────────
// Runs at 03:00 UTC every Monday. Skips automatically if the last successful
// sync was less than 7 days ago (guards against double-fire on redeploy).
if (process.env.UEX_KEY) {
  cron.schedule('0 3 * * 1', async () => {
    const lastSuccess = await prisma.uexSyncLog.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { completedAt: 'desc' },
    });
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastSuccess?.completedAt && lastSuccess.completedAt > sevenDaysAgo) {
      console.log('[uex] Scheduled sync skipped — last sync was recent');
      return;
    }
    console.log('[uex] Starting scheduled weekly sync…');
    try {
      await runUexSync('SCHEDULED');
    } catch (err) {
      console.error('[uex] Could not start scheduled sync:', err);
    }
  });
  console.log('[uex] Weekly sync scheduled (Mondays 03:00 UTC)');
} else {
  console.warn('[uex] UEX_KEY not set — weekly sync disabled');
}

// The old weekly scunpacked download into the Sc* tables is retired (v1.11.1):
// the SC Database page reads the sc-data worker's copy (scdata schema) instead.

app.listen(PORT, async () => {
  console.log(`[API] Listening on http://localhost:${PORT}`);

  // Link saved inventory entries to game items (sc-data); logs what couldn't be linked.
  void linkInventoryOnStartup();

  // Build the Blueprints / Crafting Calculator data now, so the first visitor doesn't wait (v1.11.2).
  void getCraftingPayload().catch((err) => console.error('[crafting] Warm-up failed (built on first request instead):', err));

  console.log(`[API] CORS origin: ${process.env.WEB_URL ?? 'http://localhost:5173'}`);

  // Admin panel (v1.13.0): "API is up" every minute, and old errors pruned daily (04:15 UTC).
  const startedAt = new Date();
  const beat = () => apiHeartbeat(startedAt).catch((err) => console.warn('[API] Heartbeat failed:', err));
  void beat();
  setInterval(beat, 60_000).unref();
  cron.schedule('15 4 * * *', () => { pruneOldErrors().catch((err) => console.error('[errorLog] Pruning failed:', err)); });

  // Ship list from RSI (v1.32.0): now, then daily at 05:20 UTC. The first run
  // also moves fleets kept the old way (per server, FleetYards) to personal fleets.
  const ships = async () => {
    const r = await refreshShipCatalog();
    if (r.source !== 'none') console.log(`[ships] ship list refreshed from ${r.source}: ${r.count} ships`);
    await migrateOldFleets();
  };
  void ships().catch((err) => console.error('[ships] Start-up refresh failed:', err));
  cron.schedule('20 5 * * *', () => { ships().catch((err) => console.error('[ships] Daily refresh failed:', err)); });

});
