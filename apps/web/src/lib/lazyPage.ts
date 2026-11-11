// Pages load when they're first opened instead of all up front (v1.12.0).
//
// After a deploy, a tab that was already open still asks for the previous
// build's page files, which no longer exist. When loading one fails, the page
// reloads once to pick up the new build; a second failure is shown as usual.

import { lazy, type ComponentType } from 'react';

const RELOADED_KEY = 'asop:reloaded-for-new-build';

function reloadOnce(err: unknown): Promise<never> {
  let already = false;
  try { already = sessionStorage.getItem(RELOADED_KEY) === '1'; sessionStorage.setItem(RELOADED_KEY, '1'); } catch { /* storage blocked: reload anyway */ }
  if (already) return Promise.reject(err);
  window.location.reload();
  return new Promise<never>(() => {}); // the page is going away
}

/** lazy() for a named export: lazyPage(() => import('./pages/X'), 'X'). */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then(
    (m) => {
      try { sessionStorage.removeItem(RELOADED_KEY); } catch { /* ignore */ }
      return { default: m[name] as ComponentType<unknown> };
    },
    reloadOnce,
  ));
}
