import 'dotenv/config';
import { createServer } from './server/app.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Warn early so OAuth routes don't silently fail
const REQUIRED_FOR_OAUTH = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];
const missing = REQUIRED_FOR_OAUTH.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[API] OAuth env vars not set: ${missing.join(', ')}`);
  console.warn('[API] Copy apps/api/.env.example → .env and fill them in to enable login');
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-CHANGE-ME') {
  console.warn('[API] SESSION_SECRET is not set – using insecure default (dev only)');
}

const app = createServer();

app.listen(PORT, () => {
  console.log(`[API] Listening on http://localhost:${PORT}`);
  console.log(`[API] CORS origin: ${process.env.WEB_URL ?? 'http://localhost:5173'}`);
});
