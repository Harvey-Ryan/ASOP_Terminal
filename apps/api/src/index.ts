import 'dotenv/config';
import { createServer } from './server/app.js';

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

app.listen(PORT, () => {
  console.log(`[API] Listening on http://localhost:${PORT}`);
  console.log(`[API] CORS origin: ${process.env.WEB_URL ?? 'http://localhost:5173'}`);
});
