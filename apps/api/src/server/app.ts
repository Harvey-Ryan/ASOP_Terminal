import express from 'express';
import cors from 'cors';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
  const isTest = process.env.NODE_ENV === 'test';

  if (isProd && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is required in production');
  }

  // Behind a reverse proxy in production (e.g. nginx, Railway) — needed for
  // secure cookies and accurate req.ip
  if (isProd) app.set('trust proxy', 1);

  // ── Security headers ───────────────────────────────────────────────────────

  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────────

  app.use(
    cors({
      origin: process.env.WEB_URL ?? 'http://localhost:5173',
      credentials: true,
    }),
  );

  // ── Body parsing ───────────────────────────────────────────────────────────

  app.use(express.json({ limit: '100kb' }));

  // ── Session ────────────────────────────────────────────────────────────────

  app.use(
    session({
      name: 'dem.sid',
      secret: process.env.SESSION_SECRET ?? 'dev-secret-CHANGE-ME',
      resave: false,
      saveUninitialized: false,
      // Replace with connect-redis before going to production.
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    }),
  );

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Skipped in test mode so the test suite doesn't exhaust its own quotas.

  if (!isTest) {
    const rateLimitMessage = { success: false, error: 'Too many requests, please try again later' };

    // Stricter limit on auth routes (login/callback initiation)
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: rateLimitMessage,
      }),
    );

    // General API rate limit
    app.use(
      '/api/guilds',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: rateLimitMessage,
      }),
    );
  }

  // ── Test-only auth endpoint ────────────────────────────────────────────────
  // Lets integration tests establish a session without going through Discord OAuth.
  // Only mounted in NODE_ENV=test — never reachable in production.

  if (isTest) {
    app.post('/test/login', (req, res) => {
      const body = req.body as { userId?: unknown; managedGuildIds?: unknown };
      const userId = typeof body.userId === 'string' ? body.userId : '';
      const managedGuildIds = Array.isArray(body.managedGuildIds)
        ? (body.managedGuildIds as string[])
        : [];
      req.session.userId = userId;
      req.session.managedGuildIds = managedGuildIds;
      req.session.managedGuildsCachedAt = Date.now() + 10 * 60_000;
      req.session.save(() => res.json({ ok: true }));
    });
  }

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
