// Sends browser errors to the API (POST /api/client-errors) for the admin
// panel (v1.13.0): crashes, unhandled errors and pages that failed to load.
// At most 10 reports per page load, the same message once, never throws.

import { newRef } from '@dem/shared';

const sent = new Set<string>();
let budget = 10;

/** Reports an error; returns a ref to show the person (generated here when the error has none). */
export function reportError(error: unknown, kind: string, ref?: string | null): string {
  const r = ref ?? newRef();
  try {
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error) ?? 'Unknown error');
    const message = `${e.name}: ${e.message}`.slice(0, 2_000);
    // Once per kind and message (a crash can also surface as a window error in development).
    const key = `${kind}|${message}`;
    if (sent.has(key) || budget <= 0) return r;
    sent.add(key);
    budget--;
    void fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack: e.stack ?? null, kind, url: window.location.href, ref: r }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* reporting must never cause more errors */ }
  return r;
}

// Errors are noise from browser extensions and from scripts we don't own.
function ours(filename?: string, stack?: string): boolean {
  const where = `${filename ?? ''} ${stack ?? ''}`;
  if (/chrome-extension:|moz-extension:|safari-extension:/.test(where)) return false;
  return !filename || filename.startsWith(window.location.origin);
}

/** Once, from main.tsx. */
export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => {
    if (!ev.error && !ev.message) return;
    if (!ours(ev.filename, (ev.error as Error | undefined)?.stack)) return;
    reportError(ev.error ?? ev.message, 'window error');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason as { name?: string } | undefined;
    if (reason?.name === 'ApiError') return; // the API already recorded it
    reportError(ev.reason, 'unhandled rejection');
  });
}
