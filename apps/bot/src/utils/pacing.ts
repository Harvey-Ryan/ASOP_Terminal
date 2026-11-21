// Deliberate pauses, and how long a scheduler check spent in them.
//
// Some checks pace their Discord calls on purpose: reminder DMs go out 5 at a
// time with 1 s between groups, roster refreshes wait between edits, and so on.
// The scheduler warns when a check takes over 5 s ("possible Discord
// rate-limit or slow query"); those planned pauses aren't either, so it
// subtracts them. `pacedSleep` records the pause on the check it runs in
// (AsyncLocalStorage, so the two scheduler loops never mix their counts);
// outside a timed check (website-triggered work) it's a plain sleep.

import { AsyncLocalStorage } from 'node:async_hooks';

const pauses = new AsyncLocalStorage<{ ms: number }>();

/** Waits `ms`; inside `measurePaced` the wait is counted as a planned pause. */
export async function pacedSleep(ms: number): Promise<void> {
  const store = pauses.getStore();
  const start = Date.now();
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (store) store.ms += Date.now() - start;
}

/** Runs `fn` and reports how long it took in total and how much of that was planned pauses. */
export async function measurePaced(
  fn: () => Promise<void>,
): Promise<{ totalMs: number; pausedMs: number; error?: unknown }> {
  const store = { ms: 0 };
  const start = Date.now();
  try {
    await pauses.run(store, fn);
    return { totalMs: Date.now() - start, pausedMs: store.ms };
  } catch (error) {
    return { totalMs: Date.now() - start, pausedMs: store.ms, error };
  }
}
