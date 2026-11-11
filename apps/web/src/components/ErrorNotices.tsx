// Site-wide error notices (v1.12.0).
//
// A button that fails used to do nothing on many pages: the error stayed
// inside its react-query mutation and nobody showed it. main.tsx now sends
// every failed mutation here, unless it shows its own error (it has an
// onError, or meta.quietErrors). A notice stays 6 seconds, or until closed.

import { useEffect, useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Notice { id: number; text: string }

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissError(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

/** Shows an error at the bottom of the screen. The same text twice in a row shows once. */
export function showError(text: string): void {
  if (notices.some((n) => n.text === text)) return;
  notices = [...notices.slice(-2), { id: nextId++, text }]; // at most three at once
  emit();
}

function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => notices,
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  useEffect(() => {
    const t = setTimeout(() => dismissError(notice.id), 6000);
    return () => clearTimeout(t);
  }, [notice.id]);
  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-destructive/50 bg-card px-3.5 py-3 text-sm text-foreground shadow-lg shadow-black/40">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <p className="flex-1 break-words">{notice.text}</p>
      <button type="button" onClick={() => dismissError(notice.id)} aria-label="Dismiss"
        className="-mr-1 -mt-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ErrorNotices() {
  const list = useNotices();
  return (
    <div role="alert" aria-live="assertive"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
      {list.map((n) => <NoticeCard key={n.id} notice={n} />)}
    </div>
  );
}
