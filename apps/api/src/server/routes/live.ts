// GET /api/live?topics=a,b,c: a Server-Sent Events stream that says which of
// the given topics changed (v1.30.0, see lib/live.ts). Each message is
// `data: {"topics":[…]}`; the page refetches what it shows for them.
//
// Id topics (loot:<sessionId>, trade:<tradeId>, …) name rows by an id the
// page already got from an API call that checked access, and a notice only
// says that something changed. Server-wide topics (auctions:<guildId>,
// loot-guild:<guildId>) are kept only for servers the person is in.

import { Router } from 'express';
import { isLiveTopic, liveTopicGuild, LIVE_MAX_TOPICS, type ApiResponse } from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { ensureListening, subscribe } from '../../lib/live.js';
import { getUserGuilds } from '../../lib/userGuilds.js';

export const liveRouter = Router();

const PING_MS = 25_000;

liveRouter.get('/live', requireAuth, async (req, res) => {
  const asked = [...new Set(String(req.query.topics ?? '').split(',').map((t) => t.trim()).filter(isLiveTopic))].slice(0, LIVE_MAX_TOPICS);
  if (!asked.length) {
    res.status(400).json({ success: false, error: 'No topics' } satisfies ApiResponse); return;
  }

  let topics = asked;
  if (asked.some((t) => liveTopicGuild(t))) {
    // The servers they manage are in the session; the rest come from the
    // cached list /auth/me already fetched.
    const mine = new Set(req.session.managedGuildIds ?? []);
    try {
      for (const g of await getUserGuilds(req.session.userId!, 30 * 60_000)) mine.add(g.id);
    } catch {
      // Discord busy: those topics fall back to polling for now.
    }
    topics = asked.filter((t) => { const g = liveTopicGuild(t); return !g || mine.has(g); });
  }

  if (!(await ensureListening())) {
    res.status(503).json({ success: false, error: 'Live updates are unavailable right now' } satisfies ApiResponse); return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ topics })}\n\n`);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    unsubscribe();
    res.end();
  };
  const unsubscribe = subscribe(topics, (hits) => { if (!closed) res.write(`data: ${JSON.stringify({ topics: hits })}\n\n`); }, close);
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  req.on('close', close);
});
