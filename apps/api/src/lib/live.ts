// Live updates, API side (v1.30.0; the write side is installLiveUpdates in
// packages/shared/src/live.ts). One Postgres connection LISTENs on
// LIVE_CHANNEL and hands each notice to the open browser streams that watch
// one of its topics (routes/live.ts).
//
// The listener starts with the first stream. While it isn't connected,
// streams are refused (503) and the ones open are ended, so browsers go back
// to polling instead of waiting for notices that won't come.

import pg from 'pg';
import { LIVE_CHANNEL, parseLiveNotice } from '@dem/shared';

interface Subscriber { topics: Set<string>; send(topics: string[]): void; end(): void }

const subscribers = new Set<Subscriber>();
let client: pg.Client | null = null;
let connected = false;
let connecting: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function dispatch(topics: string[]): void {
  if (!topics.length) return;
  for (const sub of subscribers) {
    const hits = topics.filter((t) => sub.topics.has(t));
    if (hits.length) sub.send(hits);
  }
}

function dropped(err?: unknown): void {
  if (err) console.warn('[live] listener lost:', err);
  connected = false;
  client?.removeAllListeners();
  client?.end().catch(() => null);
  client = null;
  // Open streams can't hear anything now: end them so the pages poll again
  // (and reconnect once we're back).
  for (const sub of subscribers) sub.end();
  subscribers.clear();
  if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void ensureListening(); }, 5_000);
}

/** Connects the listener if it isn't; resolves true once it is. */
export async function ensureListening(): Promise<boolean> {
  if (connected) return true;
  if (!connecting) {
    connecting = (async () => {
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      c.on('error', (err) => dropped(err));
      c.on('end', () => { if (client === c) dropped(); });
      c.on('notification', (msg) => { if (msg.channel === LIVE_CHANNEL) dispatch(parseLiveNotice(msg.payload)); });
      try {
        await c.connect();
        await c.query(`LISTEN ${LIVE_CHANNEL}`);
        client = c;
        connected = true;
      } catch (err) {
        console.warn('[live] listener could not connect:', err);
        c.removeAllListeners();
        c.end().catch(() => null);
      }
    })().finally(() => { connecting = null; });
  }
  await connecting;
  return connected;
}

/** Watches `topics` until the returned function is called. */
export function subscribe(topics: Iterable<string>, send: (topics: string[]) => void, end: () => void): () => void {
  const sub: Subscriber = { topics: new Set(topics), send, end };
  subscribers.add(sub);
  return () => { subscribers.delete(sub); };
}
