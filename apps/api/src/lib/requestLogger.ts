import { prisma } from './prisma.js';

interface LogEntry {
  method: string;
  path: string;
  module: string;
  guildId: string | null;
  userId: string | null;
  statusCode: number;
  durationMs: number;
}

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await prisma.requestLog.createMany({ data: batch });
  } catch {
    // Non-fatal — drop the batch rather than retrying or crashing
  }
}

export function logRequest(entry: LogEntry): void {
  buffer.push(entry);
  if (!flushTimer) {
    flushTimer = setInterval(() => { void flush(); }, 10_000);
    process.once('SIGTERM', () => { void flush(); });
    process.once('SIGINT',  () => { void flush(); });
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

// Replace ID-like segments (8+ alphanumeric chars, common for cuid / snowflake)
// so the stored path doesn't explode with unique values.
const ID_RE = /\/[a-zA-Z0-9_-]{8,}/g;

export function normalizePath(raw: string): string {
  return raw.replace(ID_RE, '/:id');
}

export function extractGuildId(path: string): string | null {
  const m = path.match(/\/guilds\/([a-zA-Z0-9_-]{8,})/);
  return m?.[1] ?? null;
}

export function deriveModule(path: string): string {
  // Strip /api prefix if present
  const p = path.startsWith('/api') ? path.slice(4) : path;

  if (p.startsWith('/guilds/')) {
    const sub = p.replace(/^\/guilds\/[^/]+/, '');
    if (sub.startsWith('/events'))              return 'events';
    if (sub.startsWith('/loot'))                return 'loot';
    if (sub.startsWith('/auctions') ||
        sub.startsWith('/standalone-auctions')) return 'auctions';
    if (sub.startsWith('/fleet'))               return 'fleet';
    if (sub.startsWith('/exchange'))            return 'exchange';
    if (sub.startsWith('/marketplace'))         return 'marketplace';
    if (sub.startsWith('/settings'))            return 'settings';
    if (sub.startsWith('/rsi'))                 return 'rsi';
    if (sub.startsWith('/images'))              return 'images';
    if (sub.startsWith('/heatmap'))             return 'activity';
    if (sub.startsWith('/traffic'))             return 'traffic';
    if (sub === '' || sub === '/')              return 'guilds';
    return 'other';
  }

  if (p.startsWith('/guilds'))    return 'guilds';
  if (p.startsWith('/auth'))      return 'auth';
  if (p.startsWith('/uex'))       return 'uex';
  if (p.startsWith('/sc'))        return 'sc-data';
  if (p.startsWith('/marketplace')) return 'marketplace';
  if (p.startsWith('/fleetyards')) return 'fleet';
  if (p.startsWith('/kanban'))    return 'kanban';
  if (p.startsWith('/alliance'))  return 'alliance';
  if (p.startsWith('/notifications')) return 'notifications';
  if (p.startsWith('/rolecall'))  return 'rolecall';
  return 'other';
}
