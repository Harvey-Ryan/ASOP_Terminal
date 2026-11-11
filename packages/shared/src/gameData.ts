// ── Game data pipeline status ────────────────────────────────────────────────
// Shared by the API (web status card) and the bot (status embed) so both read
// and judge the sc-data worker's state the same way.
//
// The tables live in the `scdata_raw` / `scdata` schemas owned by apps/sc-data
// (not Prisma). Run GAME_DATA_STATUS_SQL with `prisma.$queryRawUnsafe`; if it
// throws because the schemas don't exist yet, treat that as "not set up".

// How often the worker runs is its Railway cron schedule, which the app can't
// read, so it's inferred from the gaps between recent scheduled runs when they
// are regular (see inferCheckIntervalMin), otherwise assumed daily. That keeps
// the "checks have stopped" warning and the wording right whether the schedule
// is every 5 minutes or daily.

/** Assumed until there are enough scheduled runs to measure (Railway: daily). */
export const GAME_DATA_DEFAULT_INTERVAL_MIN = 24 * 60;

/** No check for this long (2½ intervals, at least 30 min) means the worker isn't running. */
export function gameDataStaleAfterMin(intervalMin: number | null): number {
  return Math.max(30, Math.round((intervalMin ?? GAME_DATA_DEFAULT_INTERVAL_MIN) * 2.5));
}

/** "every 5 min", "hourly", "every 6 h", "daily", "every 2 days" */
export function describeCheckInterval(intervalMin: number | null): string {
  const m = intervalMin ?? GAME_DATA_DEFAULT_INTERVAL_MIN;
  if (m < 60) return `every ${m} min`;
  if (Math.abs(m - 60) <= 5) return 'hourly';
  if (Math.abs(m - 1440) <= 60) return 'daily';
  if (m < 1440) return `every ${Math.round(m / 60)} h`;
  return `every ${Math.round(m / 1440)} days`;
}

export const GAME_DATA_STATUS_SQL = `
SELECT json_build_object(
  'state', (SELECT row_to_json(s) FROM (
      SELECT commit, build, committed_at, synced_at FROM scdata_raw.state) s),
  'last_check', (SELECT max(started_at) FROM scdata_raw.sync_run),
  -- gaps between the last scheduled runs (manual "Sync now" runs excluded), newest first
  'check_gaps_sec', (SELECT coalesce(json_agg(gap ORDER BY id DESC), '[]'::json) FROM (
      SELECT id, extract(epoch FROM started_at - lag(started_at) OVER (ORDER BY id)) AS gap
      FROM (SELECT id, started_at FROM scdata_raw.sync_run
            WHERE trigger IN ('cron', 'retry') ORDER BY id DESC LIMIT 10) recent) gaps
      WHERE gap > 0),
  'running', (SELECT row_to_json(r) FROM (
      SELECT started_at, trigger FROM scdata_raw.sync_run
      WHERE status = 'running' AND started_at > now() - interval '1 hour'
        -- a run that finished later supersedes it (an interrupted run can linger)
        AND id > coalesce((SELECT max(id) FROM scdata_raw.sync_run WHERE status IN ('success', 'failed')), 0)
      ORDER BY id DESC LIMIT 1) r),
  'last_run', (SELECT row_to_json(r) FROM (
      SELECT status, trigger, started_at, finished_at, error FROM scdata_raw.sync_run
      WHERE status IN ('success', 'failed') ORDER BY id DESC LIMIT 1) r),
  'last_success', (SELECT row_to_json(r) FROM (
      SELECT finished_at, files_added, files_changed, files_removed FROM scdata_raw.sync_run
      WHERE status = 'success'
        AND coalesce(files_added, 0) + coalesce(files_changed, 0) + coalesce(files_removed, 0) > 0
      ORDER BY id DESC LIMIT 1) r),
  'pending', (SELECT row_to_json(q) FROM (
      SELECT requested_at, requested_by FROM scdata_raw.sync_request
      WHERE handled_at IS NULL ORDER BY id LIMIT 1) q),
  'counts', json_build_object(
      'items',       (SELECT count(*) FROM scdata.items WHERE NOT is_placeholder),
      'ships',       (SELECT count(*) FROM scdata.ships),
      'contracts',   (SELECT count(*) FROM scdata.contracts),
      'blueprints',  (SELECT count(*) FROM scdata.blueprints),
      'commodities', (SELECT count(*) FROM scdata.commodities))
) AS status`;

export type GameDataHealth = 'ok' | 'syncing' | 'failed' | 'stale' | 'not_set_up';

export interface GameDataStatus {
  health: GameDataHealth;
  /** Upstream commit / game build we hold, and when upstream published it */
  commit: string | null;
  build: string | null;
  committedAt: string | null;
  /** When that build finished loading into our database */
  syncedAt: string | null;
  /** Last time the worker checked upstream (any outcome) */
  lastCheckAt: string | null;
  /** Typical minutes between scheduled checks (null until measurable) */
  checkIntervalMin: number | null;
  running: { startedAt: string; trigger: string } | null;
  lastRun: { status: 'success' | 'failed'; trigger: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
  /** The last sync that actually changed something (forced re-checks that found nothing don't count) */
  lastChange: { finishedAt: string | null; added: number; changed: number; removed: number } | null;
  pendingRequest: { requestedAt: string; requestedBy: string | null } | null;
  counts: { items: number; ships: number; contracts: number; blueprints: number; commodities: number } | null;
}

export const GAME_DATA_NOT_SET_UP: GameDataStatus = {
  health: 'not_set_up', commit: null, build: null, committedAt: null, syncedAt: null, lastCheckAt: null, checkIntervalMin: null,
  running: null, lastRun: null, lastChange: null, pendingRequest: null, counts: null,
};

interface RawStatus {
  state: { commit: string | null; build: string | null; committed_at: string | null; synced_at: string | null } | null;
  last_check: string | null;
  check_gaps_sec: number[] | null;
  running: { started_at: string; trigger: string } | null;
  last_run: { status: 'success' | 'failed'; trigger: string; started_at: string; finished_at: string | null; error: string | null } | null;
  last_success: { finished_at: string | null; files_added: number | null; files_changed: number | null; files_removed: number | null } | null;
  pending: { requested_at: string; requested_by: string | null } | null;
  counts: Record<string, number | string> | null;
}

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
/**
 * The worker's schedule in minutes, if the recent scheduled runs show one.
 * Runs are only trusted as a schedule when there are at least 3 gaps and at
 * least 3 in 4 sit within 20% (or 2 minutes) of the median. Runs triggered by
 * deploys or restarts come at irregular times, so they don't count as a
 * schedule; until one is clear, the daily default applies (no false
 * "checks have stopped" after a busy deploy day).
 */
export function inferCheckIntervalMin(gapsSec: number[] | null | undefined): number | null {
  const gaps = (gapsSec ?? []).filter((g) => Number.isFinite(g) && g > 0);
  if (gaps.length < 3) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const tolerance = Math.max(median * 0.2, 120);
  const regular = gaps.filter((g) => Math.abs(g - median) <= tolerance).length;
  if (regular / gaps.length < 0.75) return null;
  return Math.max(1, Math.round(median / 60));
}

/** Turns the row from GAME_DATA_STATUS_SQL (its `status` column) into a GameDataStatus. */
export function parseGameDataStatus(raw: unknown, now: Date = new Date()): GameDataStatus {
  const r = (typeof raw === 'string' ? JSON.parse(raw) : raw) as RawStatus | null;
  if (!r || !r.state?.commit) {
    const empty: GameDataStatus = {
      ...GAME_DATA_NOT_SET_UP,
      lastCheckAt: iso(r?.last_check),
      checkIntervalMin: inferCheckIntervalMin(r?.check_gaps_sec),
      running: r?.running ? { startedAt: iso(r.running.started_at)!, trigger: r.running.trigger } : null,
      lastRun: r?.last_run
        ? { status: r.last_run.status, trigger: r.last_run.trigger, startedAt: iso(r.last_run.started_at)!, finishedAt: iso(r.last_run.finished_at), error: r.last_run.error }
        : null,
      pendingRequest: r?.pending ? { requestedAt: iso(r.pending.requested_at)!, requestedBy: r.pending.requested_by } : null,
    };
    empty.health = judgeHealth(empty, now);
    return empty;
  }
  const n = (v: number | string | null | undefined) => Number(v ?? 0);
  const status: GameDataStatus = {
    health: 'ok',
    commit: r.state.commit,
    build: r.state.build,
    committedAt: iso(r.state.committed_at),
    syncedAt: iso(r.state.synced_at),
    lastCheckAt: iso(r.last_check),
    checkIntervalMin: inferCheckIntervalMin(r.check_gaps_sec),
    running: r.running ? { startedAt: iso(r.running.started_at)!, trigger: r.running.trigger } : null,
    lastRun: r.last_run
      ? { status: r.last_run.status, trigger: r.last_run.trigger, startedAt: iso(r.last_run.started_at)!, finishedAt: iso(r.last_run.finished_at), error: r.last_run.error }
      : null,
    lastChange: r.last_success
      ? { finishedAt: iso(r.last_success.finished_at), added: n(r.last_success.files_added), changed: n(r.last_success.files_changed), removed: n(r.last_success.files_removed) }
      : null,
    pendingRequest: r.pending ? { requestedAt: iso(r.pending.requested_at)!, requestedBy: r.pending.requested_by } : null,
    counts: r.counts
      ? { items: n(r.counts['items']), ships: n(r.counts['ships']), contracts: n(r.counts['contracts']), blueprints: n(r.counts['blueprints']), commodities: n(r.counts['commodities']) }
      : null,
  };
  status.health = judgeHealth(status, now);
  return status;
}

export function judgeHealth(s: GameDataStatus, now: Date = new Date()): GameDataHealth {
  if (s.running) return 'syncing';
  if (s.lastRun?.status === 'failed') return 'failed';
  if (!s.commit) return 'not_set_up';
  const lastCheck = s.lastCheckAt ? new Date(s.lastCheckAt).getTime() : 0;
  if (now.getTime() - lastCheck > gameDataStaleAfterMin(s.checkIntervalMin) * 60_000) return 'stale';
  return 'ok';
}

/**
 * A tiny query whose result changes whenever the status could: a run starts or
 * finishes (or changes status), the synced commit moves, or a "Sync now"
 * request arrives or is handled. Lets the status embed skip the full status
 * query (and Discord) on quiet minutes.
 */
export const GAME_DATA_CHANGE_SQL = `
SELECT json_build_object(
  'run',     (SELECT row_to_json(r) FROM (SELECT id, status FROM scdata_raw.sync_run ORDER BY id DESC LIMIT 1) r),
  'commit',  (SELECT commit FROM scdata_raw.state),
  'request', (SELECT max(id) FROM scdata_raw.sync_request WHERE handled_at IS NULL)
)::text AS token`;

/**
 * The next moment the status changes on its own with nothing new in the
 * database: an "updating" run passes the 1-hour window the status query
 * allows it, or checks stop and the data turns stale. Null if neither applies.
 */
export function gameDataRecheckAt(s: GameDataStatus): Date | null {
  const times: number[] = [];
  if (s.running) times.push(new Date(s.running.startedAt).getTime() + 60 * 60_000);
  if (s.health !== 'stale' && s.lastCheckAt) {
    times.push(new Date(s.lastCheckAt).getTime() + gameDataStaleAfterMin(s.checkIntervalMin) * 60_000);
  }
  return times.length > 0 ? new Date(Math.min(...times) + 1000) : null;
}

/** True for "schema/table doesn't exist" errors, i.e. the worker hasn't run yet. */
export function isGameDataMissingError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  const code = e?.meta?.code ?? e?.code;
  return code === '42P01' || code === '3F000' || /does not exist/i.test(e?.message ?? '');
}
