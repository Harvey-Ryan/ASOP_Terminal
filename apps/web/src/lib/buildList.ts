// The Crafting Calculator's build list (v1.26.0): blueprints to craft, with
// quantities. Kept in this browser (localStorage), shared by every tab and
// every server's calculator; it works without it (private mode) for the visit.

import { useSyncExternalStore } from 'react';

export interface BuildListItem { uuid: string; qty: number }

const KEY = 'asop-crafting-build-list';
const MAX_QTY = 999;
let items: BuildListItem[] = read();
const listeners = new Set<() => void>();

function read(): BuildListItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is BuildListItem => typeof x?.uuid === 'string' && Number.isInteger(x?.qty) && x.qty > 0).slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

function write(next: BuildListItem[]) {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { items = read(); for (const l of listeners) l(); } });
}

export const buildList = {
  add(uuid: string, by = 1) {
    const found = items.find((i) => i.uuid === uuid);
    write(found
      ? items.map((i) => (i.uuid === uuid ? { ...i, qty: Math.min(MAX_QTY, i.qty + by) } : i))
      : [...items, { uuid, qty: Math.min(MAX_QTY, by) }]);
  },
  setQty(uuid: string, qty: number) {
    write(qty > 0 ? items.map((i) => (i.uuid === uuid ? { ...i, qty: Math.min(MAX_QTY, Math.floor(qty)) } : i)) : items.filter((i) => i.uuid !== uuid));
  },
  remove(uuid: string) { write(items.filter((i) => i.uuid !== uuid)); },
  clear() { write([]); },
};

export function useBuildList(): BuildListItem[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => items,
    () => items,
  );
}
