// Small pieces shared by the admin pages (v1.13.0).

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ErrorLevel, ErrorSource } from '@dem/shared';
import { cn } from '@/lib/utils';

export const ADMIN = '/dashboard/admin';

/** "3 min ago", "2 h ago", "Nov 9" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 45_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

const SOURCE_CLS: Record<ErrorSource, string> = {
  api: 'bg-sky-500/15 text-sky-300',
  bot: 'bg-violet-500/15 text-violet-300',
  web: 'bg-emerald-500/15 text-emerald-300',
  'sc-data': 'bg-orange-500/15 text-orange-300',
};

export function SourceBadge({ source }: { source: ErrorSource }) {
  return <span className={cn('rounded px-1.5 py-0.5 font-mono text-[11px] uppercase', SOURCE_CLS[source] ?? 'bg-muted')}>{source}</span>;
}

export function LevelDot({ level }: { level: ErrorLevel }) {
  return <span title={level} className={cn('inline-block h-2 w-2 shrink-0 rounded-full', level === 'error' ? 'bg-red-500' : 'bg-yellow-400')} />;
}

export function Stat({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn'; to?: string }) {
  const body = (
    <div className={cn('rounded-lg border bg-card p-3 sm:p-4 h-full', to && 'hover:border-primary/60 transition-colors')}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-xl sm:text-2xl font-semibold tabular-nums break-words',
        tone === 'good' && 'text-emerald-400', tone === 'bad' && 'text-red-400', tone === 'warn' && 'text-yellow-300')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const selectCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
export const inputCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function LoadFailed({ error }: { error: unknown }) {
  return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">Couldn't load this: {error instanceof Error ? error.message : 'unknown error'}</p>;
}
