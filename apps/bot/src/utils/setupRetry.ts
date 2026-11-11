// How the scheduler retries Discord setup that didn't finish (an event's
// thread and Discord event, or an accepted share posted in an ally's server).
// v1.11.1: before this, the five oldest unfinished items were retried every
// minute forever, so items that could never finish (no forum channel set, the
// bot removed from the server) took every slot and newer ones were never retried.

/** After this many scheduler attempts (about 6 hours), stop and log once. */
export const SETUP_MAX_ATTEMPTS = 12;

/** Wait after the n-th failed attempt: 1, 2, 4, 8, 16, 32, then 60 minutes. */
export function setupRetryDelayMs(attempts: number): number {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return minutes * 60_000;
}

/** The fields to save after an attempt: reset when it worked, otherwise count it and schedule the next. */
export function afterSetupAttempt(done: boolean, attemptsBefore: number, now: Date): { setupAttempts: number; nextSetupAt: Date | null; gaveUp: boolean } {
  if (done) return { setupAttempts: 0, nextSetupAt: null, gaveUp: false };
  const attempts = attemptsBefore + 1;
  return {
    setupAttempts: attempts,
    nextSetupAt: new Date(now.getTime() + setupRetryDelayMs(attempts)),
    gaveUp: attempts >= SETUP_MAX_ATTEMPTS,
  };
}
