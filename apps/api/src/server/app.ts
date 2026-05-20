import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'node:path';
import { authRouter } from './routes/auth.js';
import { guildsRouter } from './routes/guilds.js';
import { eventsRouter } from './routes/events.js';
import { imagesRouter } from './routes/images.js';
import { settingsRouter } from './routes/settings.js';
import { lootRouter } from './routes/loot.js';
import type { ApiResponse } from '@dem/shared';

export function createServer(): express.Express {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Behind a reverse proxy in production (e.g. nginx, fly.io) – needed for
  // secure cookies and accurate req.ip
  if (isProd) app.set('trust proxy', 1);

  // ── Global middleware ──────────────────────────────────────────────────────

  app.use(
    cors({
      origin: process.env.WEB_URL ?? 'http://localhost:5173',
      credentials: true, // required so the browser sends the session cookie
    }),
  );

  app.use(express.json());

  app.use(
    session({
      name: 'dem.sid',
      // In production always use a strong random string (32+ chars)
      // || instead of ?? so an empty-string env var also falls back
      secret: process.env.SESSION_SECRET || 'dev-secret-CHANGE-ME',
      resave: false,
      saveUninitialized: false,
      // Default store is MemoryStore – fine for dev.
      // Replace with connect-redis (or similar) before going to production.
      cookie: {
        httpOnly: true,
        secure: isProd,       // HTTPS only in prod
        sameSite: 'lax',      // 'lax' allows the cookie through OAuth redirects
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    }),
  );

  // ── Request logger ─────────────────────────────────────────────────────────

  app.use((req, _res, next) => {
    console.log(`[api] ${req.method} ${req.path}`);
    next();
  });

  // ── Static uploads ─────────────────────────────────────────────────────────

  app.use('/uploads', express.static(path.resolve('uploads')));

  // ── Routes ─────────────────────────────────────────────────────────────────

  app.use('/api/auth', authRouter);
  app.use('/api/guilds', guildsRouter);
  app.use('/api/guilds', eventsRouter);
  app.use('/api/guilds', imagesRouter);
  app.use('/api/guilds', settingsRouter);
  app.use('/api/guilds', lootRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: { timestamp: new Date().toISOString() },
      message: 'Discord Event Manager API is running',
    } satisfies ApiResponse<{ timestamp: string }>);
  });

  // ── 404 catch-all ──────────────────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse);
  });

  return app;
}
