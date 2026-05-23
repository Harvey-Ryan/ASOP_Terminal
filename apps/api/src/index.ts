import 'dotenv/config';
import cron from 'node-cron';
import { createServer } from './server/app.js';
import { runUexSync } from './lib/uexSync.js';
import { prisma } from './lib/prisma.js';

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

app.listen(PORT, () => {
  console.log(`[API] Listening on http://localhost:${PORT}`);
  console.log(`[API] CORS origin: ${process.env.WEB_URL ?? 'http://localhost:5173'}`);
});
