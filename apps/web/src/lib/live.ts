// Live updates, browser side (v1.30.0). One stream per tab (GET /api/live)
// for every topic the mounted pages watch; a notice refetches the queries
// that show that topic. See packages/shared/src/live.ts.
//
// While the stream is up a page's polling drops to a slow safety net
// (LIVE_SAFETY_MS); when it isn't (not connected yet, dropped, refused) the
// page polls at its old pace.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { LIVE_MAX_TOPICS } from '@dem/shared';

/** Polling while the stream is up, just in case a notice is missed. */
export const LIVE_SAFETY_MS = 60_000;

interface Listener { topics: string[]; onChange(topics: string[]): void }

const listeners = new Set<Listener>();
const statusSubs = new Set<() => void>();
let source: EventSource | null = null;
let sourceTopics = '';
/** Topics the open stream accepted; empty while it isn't up. */
let accepted = new Set<string>();
let hadGap = false;
let failures = 0;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setAccepted(next: Set<string>) {
  accepted = next;
  for (const fn of statusSubs) fn();
}

function wanted(): string {
  const all = new Set<string>();
  for (const l of listeners) for (const t of l.topics) all.add(t);
  return [...all].sort().slice(0, LIVE_MAX_TOPICS).join(',');
}

function closeSource() {
  source?.close();
  source = null;
  sourceTopics = '';
  if (accepted.size) setAccepted(new Set());
}

function reconcile() {
  const want = wanted();
  if (source && want === sourceTopics) return;
  closeSource();
  if (!want || typeof EventSource === 'undefined' || retryTimer) return;

  const es = new EventSource(`/api/live?topics=${encodeURIComponent(want)}`, { withCredentials: true });
  source = es;
  sourceTopics = want;
  es.addEventListener('ready', (e) => {
    failures = 0;
    let topics: string[] = [];
    try { topics = (JSON.parse((e as MessageEvent).data) as { topics: string[] }).topics; } catch { /* none */ }
    setAccepted(new Set(topics));
    // Anything that changed while we weren't listening: fetch it once.
    if (hadGap) {
      hadGap = false;
      for (const l of listeners) l.onChange(l.topics);
    }
  });
  es.onmessage = (e) => {
    let topics: string[] = [];
    try { topics = (JSON.parse(e.data) as { topics: string[] }).topics; } catch { return; }
    for (const l of listeners) {
      const hits = l.topics.filter((t) => topics.includes(t));
      if (hits.length) l.onChange(hits);
    }
  };
  es.onerror = () => {
    if (source !== es) return;
    hadGap = true;
    if (accepted.size) setAccepted(new Set());
    // The browser retries a dropped stream itself; a refused one (503, 401)
    // is closed for good, so try again later, waiting longer each time.
    if (es.readyState === EventSource.CLOSED) {
      closeSource();
      failures++;
      const wait = Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4));
      retryTimer = setTimeout(() => { retryTimer = null; reconcile(); }, wait);
    }
  };
}

function scheduleReconcile() {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => { reconcileTimer = null; reconcile(); }, 50);
}

const clean = (topics: (string | null | undefined | false)[]) => [...new Set(topics.filter((t): t is string => !!t))].sort();

/**
 * Watches `topics` while mounted and calls `onChange` with the ones that
 * changed. Returns true while all of them are being watched live.
 */
export function useLiveTopics(topics: (string | null | undefined | false)[], onChange: (topics: string[]) => void): boolean {
  const list = clean(topics);
  const key = list.join(',');
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!key) return;
    const l: Listener = { topics: key.split(','), onChange: (t) => cb.current(t) };
    listeners.add(l);
    scheduleReconcile();
    return () => { listeners.delete(l); scheduleReconcile(); };
  }, [key]);

  const snapshot = useSyncExternalStore(
    (fn) => { statusSubs.add(fn); return () => { statusSubs.delete(fn); }; },
    () => accepted,
  );
  return list.length > 0 && list.every((t) => snapshot.has(t));
}

/**
 * Refetches `queryKeys` (prefix match) whenever one of `topics` changes.
 * Returns true while live, for picking a refetchInterval:
 * `refetchInterval: live ? LIVE_SAFETY_MS : 4000`.
 */
export function useLiveQueries(topics: (string | null | undefined | false)[], queryKeys: QueryKey[]): boolean {
  const qc = useQueryClient();
  const keys = useRef(queryKeys);
  keys.current = queryKeys;
  return useLiveTopics(topics, () => {
    for (const queryKey of keys.current) pendingKeys.set(JSON.stringify(queryKey), queryKey);
    // Several pages or cards watching the same thing: refetch it once.
    if (!flushQueued) {
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        const all = [...pendingKeys.values()];
        pendingKeys.clear();
        for (const queryKey of all) void qc.invalidateQueries({ queryKey });
      });
    }
  });
}

const pendingKeys = new Map<string, QueryKey>();
let flushQueued = false;
