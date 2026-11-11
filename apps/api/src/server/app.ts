import express, { type ErrorRequestHandler } from 'express';
import './asyncErrors.js';
import { requestContext, recordError } from '../lib/errorLog.js';
import { adminRouter } from './routes/admin.js';
import { clientErrorsRouter } from './routes/clientErrors.js';

// Printed without being recorded a second time (the error handler records it itself).
const original500Log = console.error.bind(console);
import cors from 'cors';
import session from 'express-session';
import ConnectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import path from 'node:path';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { imagesRouter } from './routes/images.js';
import { settingsRouter } from './routes/settings.js';
import { lootRouter } from './routes/loot.js';
import { auctionRouter } from './routes/loot-auction.js';
import { auctionRouter as standaloneAuctionRouter } from './routes/auction.js';
import { uexRouter } from './routes/uex.js';
import { exchangeRouter } from './routes/exchange.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { scRouter } from './routes/sc.js';
import { fleetRouter, fleetyardsRouter } from './routes/fleet.js';
import { rsiRouter } from './routes/rsi.js';
import { kanbanRouter } from './routes/kanban.js';
import { alliesRouter } from './routes/allies.js';
import { notificationsRouter } from './routes/notifications.js';
import { calendarRouter } from './routes/calendar.js';
import { membersRouter } from './routes/members.js';
import { jobsRouter } from './routes/jobs.js';
import { roleCallRouter } from './routes/rolecall.js';
import { heatmapRouter } from './routes/heatmap.js';
import { trafficRouter } from './routes/traffic.js';
import { tournamentRouter } from './routes/tournament.js';
import { gameDataRouter } from './routes/gameData.js';
import { catalogRouter } from './routes/catalog.js';
import { APP_VERSION, APP_COMMIT } from '../lib/appVersion.js';
import { memberPinsRouter } from './routes/memberPins.js';
import { logRequest, normalizePath, deriveModule, extractGuildId, requestLoggingOn } from '../lib/requestLogger.js';
import type { ApiResponse } from '@dem/shared';
import { discordBusyAsServiceUnavailable } from '../lib/memberRoles.js';

const PgSession = ConnectPgSimple(session);

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

  // ── Request context ────────────────────────────────────────────────────────
  // A ref per request (X-Request-Id), kept with anything recorded while it's
  // handled (lib/errorLog.ts, v1.13.0).
  app.use(requestContext);

  // ── Security headers ───────────────────────────────────────────────────────
  // Allow Discord CDN images (avatars, guild icons) in the SPA.

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.fleetyards.net', 'https://unpkg.com'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );

  // ── CORS ──────────────────────────────────────────────────────────────────

  const webOrigin    = process.env.WEB_URL ?? 'http://localhost:5173';
  const publicOrigin = process.env.PUBLIC_SITE_URL;

  app.use(
    cors({
      origin: publicOrigin ? [webOrigin, publicOrigin] : webOrigin,
      credentials: true,
    }),
  );

  // ── Body parsing ───────────────────────────────────────────────────────────

  app.use(express.json({ limit: '100kb' }));

  // A refusal caused only by Discord being unreachable answers 503 "try again" (v1.11.1).
  app.use(discordBusyAsServiceUnavailable);

  // ── Session ────────────────────────────────────────────────────────────────

  app.use(
    session({
      name: 'dem.sid',
      secret: process.env.SESSION_SECRET ?? 'dev-secret-CHANGE-ME',
      resave: false,
      saveUninitialized: false,
      store: isProd
        ? new PgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true })
        : undefined,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    }),
  );

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Only enforced in production — dev and test environments are not rate-limited.

  if (isProd) {
    const rateLimitMessage = { success: false, error: 'Too many requests, please try again later' };

    // Key by session ID when authenticated so each user gets their own bucket
    // rather than sharing a bucket with everyone behind the same IP/proxy.
    const keyGenerator = (req: express.Request) =>
      (req.sessionID as string | undefined) ?? ipKeyGenerator(req.ip ?? '');

    // Stricter limit on auth routes (login/callback initiation)
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        keyGenerator,
        standardHeaders: true,
        legacyHeaders: false,
        message: rateLimitMessage,
      }),
    );

    // Calendar feeds are fetched by calendar apps every hour or so (v1.16.0).
    app.use(
      '/api/calendar',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
        standardHeaders: true,
        legacyHeaders: false,
        message: rateLimitMessage,
      }),
    );

    // General API rate limit — high enough for active users with polling queries
    app.use(
      '/api/guilds',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 2000,
        keyGenerator,
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
      // managedGuildIds: null = no list yet, so the manager check asks Discord.
      if (body.managedGuildIds !== null) {
        req.session.managedGuildIds = managedGuildIds;
        req.session.managedGuildsCachedAt = Date.now() + 10 * 60_000;
      }
      req.session.save(() => res.json({ ok: true }));
    });
  }

  // ── Request logger ─────────────────────────────────────────────────────────

  app.use((req, res, next) => {
    console.log(`[api] ${req.method} ${req.path.replace(/^\/api\/calendar\/[^/]+/, '/api/calendar/…')}`); // feed links are secret
    if (!isTest && requestLoggingOn()) {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path === '/api/health' || req.path.startsWith('/test/')) return;
        logRequest({
          method:     req.method,
          path:       normalizePath(req.path),
          module:     deriveModule(req.path),
          guildId:    extractGuildId(req.path),
          userId:     req.session?.userId ?? null,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
        });
      });
    }
    next();
  });

  // ── Static uploads ─────────────────────────────────────────────────────────
  // Set CORP to cross-origin so browsers on a different port can load images.
  // Helmet's default (same-origin) blocks <img> from localhost:5173 → :3001.

  const uploadsDir = process.env['UPLOADS_DIR'] ?? path.resolve('uploads');
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(uploadsDir),
    // If the file wasn't found, return a proper 404 image response instead of
    // falling through to the SPA catch-all (which would serve index.html as
    // the image body, producing a silent broken-image with status 200).
    (_req, res) => res.status(404).end(),
  );

  // ── Routes ─────────────────────────────────────────────────────────────────

  app.use('/api/auth', authRouter);
  app.use('/api/guilds', eventsRouter);
  app.use('/api/guilds', imagesRouter);
  app.use('/api/guilds', settingsRouter);
  app.use('/api/guilds', lootRouter);
  app.use('/api/guilds', auctionRouter);
  app.use('/api/guilds', standaloneAuctionRouter);
  app.use('/api', uexRouter);
  app.use('/api', scRouter);
  app.use('/api', gameDataRouter);
  app.use('/api', catalogRouter);
  app.use('/api/guilds', exchangeRouter);
  app.use('/api', marketplaceRouter);
  app.use('/api/guilds', fleetRouter);
  app.use('/api', fleetyardsRouter);
  app.use('/api/guilds', rsiRouter);
  app.use('/api', kanbanRouter);
  app.use('/api/guilds', alliesRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', calendarRouter);
  app.use('/api', roleCallRouter);
  app.use('/api/guilds', heatmapRouter);
  app.use('/api/guilds', trafficRouter);
  app.use('/api/guilds', tournamentRouter);
  app.use('/api/guilds', memberPinsRouter);
  app.use('/api/guilds', membersRouter);
  app.use('/api/guilds', jobsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', clientErrorsRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: { timestamp: new Date().toISOString(), version: APP_VERSION, commit: APP_COMMIT },
      message: 'Discord Event Manager API is running',
    } satisfies ApiResponse<{ timestamp: string; version: string; commit: string }>);
  });

  // ── API 404 (must come before SPA catch-all) ──────────────────────────────

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse);
  });

  // ── SPA serving (production only) ─────────────────────────────────────────
  // In production the compiled React app lives at ../web/dist relative to the
  // API working directory. Express serves static assets first; everything else
  // falls through to index.html so React Router handles client-side navigation.

  if (isProd) {
    const webDist = path.resolve(process.cwd(), '../web/dist');
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // ── 404 catch-all ──────────────────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' } satisfies ApiResponse);
  });


  // ── Errors ─────────────────────────────────────────────────────────────────
  // Anything a route throws or rejects with ends here (see asyncErrors.ts):
  // logged, and answered with JSON instead of stopping the process (v1.11.3).
  // Client errors that are safe to show (bad JSON, body too large) keep their
  // status and message.
  const onError: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; expose?: boolean; message?: string };
    const status = e.status ?? e.statusCode ?? 500;
    if (status >= 500) {
      const e2 = err instanceof Error ? err : new Error(String(err));
      original500Log(`[API] ${req.method} ${req.originalUrl} failed:`, e2);
      recordError({ message: `${e2.name}: ${e2.message}`, stack: e2.stack ?? null, context: { status } });
    }
    const clientError = status >= 400 && status < 500 && e.expose;
    res.status(clientError ? status : 500).json({
      success: false,
      error: clientError && e.message ? e.message : 'Something went wrong. Please try again.',
    } satisfies ApiResponse);
  };
  app.use(onError);

  return app;
}
