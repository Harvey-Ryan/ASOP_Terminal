// Error recording shared by the API, the bot and the website (v1.13.0).
//
// Each process makes one ErrorRecorder with a write() that stores rows (the
// API and bot insert into ErrorEvent; the browser posts to the API). The
// recorder turns errors into rows, groups identical ones by fingerprint, limits
// how many of one kind are stored per minute, redacts secrets, and writes in
// batches so a burst of errors can't overload the database.
//
// No Node or browser APIs here: it runs everywhere.

export type ErrorSource = 'api' | 'bot' | 'web' | 'sc-data';
export type ErrorLevel = 'error' | 'warn';

export interface ErrorInput {
  level?: ErrorLevel;
  message: string;
  stack?: string | null;
  ref?: string | null;
  guildId?: string | null;
  userId?: string | null;
  context?: Record<string, unknown>;
}

/** A row as stored in ErrorEvent (without id / createdAt). */
export interface ErrorRow {
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  stack: string | null;
  fingerprint: string;
  ref: string | null;
  guildId: string | null;
  userId: string | null;
  context: string;
  release: string;
  suppressed: number;
}

// ── Reference codes ──────────────────────────────────────────────────────────

const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

/** A short code people can quote ("Ref K7QW3P") to find the exact error. Not secret. */
export function newRef(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return s;
}

// ── Redaction ────────────────────────────────────────────────────────────────

const SECRET_PATTERNS: [RegExp, string][] = [
  [/[A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6,7}\.[A-Za-z\d_-]{27,40}/g, '[discord-token]'],
  [/(Bearer|Bot)\s+[A-Za-z\d._~+/=-]{16,}/gi, '$1 [redacted]'],
  [/(\w+:\/\/[^:/\s]+):[^@\s]+@/g, '$1:[redacted]@'],
  [/((?:password|passwd|secret|token|api[_-]?key|client_secret|access_token|refresh_token)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi, '$1[redacted]'],
];

/** Removes tokens, passwords and credentials in URLs from text before it's stored. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// ── Fingerprints ─────────────────────────────────────────────────────────────

/** The message with the parts that change between occurrences (ids, numbers, quoted values) removed. */
export function normaliseMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\bc[a-z0-9]{20,30}\b/g, '<id>')
    .replace(/\b\d{15,21}\b/g, '<snowflake>')
    .replace(/(["'`])(?:(?!\1).){1,80}\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** The first stack frame in our own code (not node_modules / node internals), without line numbers. */
export function firstAppFrame(stack: string | null | undefined): string {
  if (!stack) return '';
  for (const line of stack.split('\n').slice(1)) {
    const l = line.trim();
    if (!l || /node_modules|node:internal|\(node:|<anonymous>|chrome-extension:/.test(l)) continue;
    // Node/Chrome: "at fn (path/file.js:12:3)" or "at path/file.js:12:3"; Firefox/Safari: "fn@url:1:2".
    const m = l.match(/^at\s+(?:(.+?)\s+\()?(.+?)\)?$/) ?? l.match(/^(.*?)@(.+)$/);
    if (!m) return l.replace(/:\d+/g, '').slice(0, 120);
    const fn = (m[1] ?? '').replace(/^async\s+/, '').replace(/\s*\[as .*\]$/, '');
    const file = (m[2] ?? '').replace(/(:\d+)+$/, '').split(/[/\\]/).pop() ?? '';
    const name = file.replace(/\.[cm]?[jt]sx?$/, '').replace(/-[A-Za-z0-9_-]{8}$/, ''); // build hash (Vite)
    return `${fn}@${name}`;
  }
  return '';
}

/** FNV-1a, 2 × 32 bits, as 16 hex characters. Stable everywhere; not for security. */
function hash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function errorFingerprint(source: ErrorSource, message: string, stack?: string | null): string {
  return hash(`${source}|${normaliseMessage(message)}|${firstAppFrame(stack)}`);
}

// ── Turning console arguments into a message ─────────────────────────────────

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return `${value.name}: ${value.message}${code !== undefined ? ` [${String(code)}]` : ''}`;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json.length > 500 ? `${json.slice(0, 500)}…` : json;
  } catch {
    return String(value);
  }
}

/** console.error('[x] Failed:', err) → message "[x] Failed: TypeError: …", stack of err. */
export function fromLogArgs(args: readonly unknown[]): { message: string; stack: string | null } {
  const err = args.find((a): a is Error => a instanceof Error);
  return { message: args.map(describe).join(' '), stack: err?.stack ?? null };
}

// ── The recorder ─────────────────────────────────────────────────────────────

export interface RecorderOptions {
  source: ErrorSource;
  release: string;
  /** Store a batch. Its failures are swallowed (and reported to fallbackLog). */
  write: (rows: ErrorRow[]) => Promise<void>;
  /** Where the recorder reports its own problems; never recorded (no loops). */
  fallbackLog?: (...args: unknown[]) => void;
  /** Extra context for the current request / interaction (AsyncLocalStorage in Node). */
  currentContext?: () => Partial<ErrorInput> | undefined;
  flushMs?: number;
  /** Rows of one kind stored per minute; the rest are counted in `suppressed`. */
  perKindPerMinute?: number;
  /** Rows waiting to be written; beyond this, new ones are dropped. */
  maxQueue?: number;
}

const MAX_MESSAGE = 2_000;
const MAX_STACK = 8_000;
const MAX_CONTEXT = 4_000;

export class ErrorRecorder {
  private queue: ErrorRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private window = new Map<string, { start: number; count: number; suppressed: number }>();
  private writing: Promise<void> | null = null;
  private readonly opts: Required<Omit<RecorderOptions, 'currentContext'>> & Pick<RecorderOptions, 'currentContext'>;

  constructor(opts: RecorderOptions) {
    this.opts = { flushMs: 2_000, perKindPerMinute: 10, maxQueue: 500, fallbackLog: () => {}, ...opts };
  }

  /** Records an error. Never throws. Returns the row's fingerprint (or null if dropped). */
  record(input: ErrorInput): string | null {
    try {
      const ctx = this.opts.currentContext?.() ?? {};
      const level = input.level ?? 'error';
      const message = redactSecrets(String(input.message || 'Unknown error')).slice(0, MAX_MESSAGE);
      const stack = input.stack ? redactSecrets(input.stack).slice(0, MAX_STACK) : null;
      const fingerprint = errorFingerprint(this.opts.source, message, stack);

      const now = Date.now();
      const w = this.window.get(fingerprint);
      if (w && now - w.start < 60_000) {
        if (w.count >= this.opts.perKindPerMinute) { w.suppressed++; return null; }
        w.count++;
      } else {
        if (this.window.size > 5_000) this.window.clear();
        this.window.set(fingerprint, { start: now, count: 1, suppressed: 0 });
      }
      const suppressed = w && now - w.start >= 60_000 ? w.suppressed : 0;
      if (this.queue.length >= this.opts.maxQueue) return null;

      let context = '{}';
      try { context = redactSecrets(JSON.stringify({ ...(ctx.context ?? {}), ...(input.context ?? {}) })).slice(0, MAX_CONTEXT); } catch { /* unserialisable */ }

      this.queue.push({
        source: this.opts.source, level, message, stack, fingerprint,
        ref: input.ref ?? ctx.ref ?? null,
        guildId: input.guildId ?? ctx.guildId ?? null,
        userId: input.userId ?? ctx.userId ?? null,
        context, release: this.opts.release, suppressed,
      });
      this.schedule();
      return fingerprint;
    } catch (err) {
      this.opts.fallbackLog('[errorLog] could not record an error:', err);
      return null;
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.flushMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Writes what's waiting now (also used on shutdown and in tests). */
  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.writing = this.opts.write(batch)
      .catch((err) => this.opts.fallbackLog(`[errorLog] dropped ${batch.length} error(s); writing them failed:`, err))
      .finally(() => { this.writing = null; });
    await this.writing;
  }
}

/**
 * Also records everything written with console.error (and console.warn as
 * warnings). Most of our code logs failures this way in its catch blocks, so
 * this captures them with no other changes. Returns the original functions.
 */
export function captureConsole(recorder: ErrorRecorder, opts: { warn?: boolean } = {}): { error: typeof console.error; warn: typeof console.warn } {
  const original = { error: console.error.bind(console), warn: console.warn.bind(console) };
  let inside = false;
  const wrap = (level: ErrorLevel, orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
    orig(...args);
    if (inside) return;
    inside = true;
    try {
      const { message, stack } = fromLogArgs(args);
      recorder.record({ level, message, stack });
    } finally {
      inside = false;
    }
  };
  console.error = wrap('error', original.error);
  if (opts.warn !== false) console.warn = wrap('warn', original.warn);
  return original;
}
