// ── Game data pipeline status ────────────────────────────────────────────────
// Shared by the API (web status card) and the bot (status embed) so both read
// and judge the sc-data worker's state the same way.
//
// The tables live in the `scdata_raw` / `scdata` schemas owned by apps/sc-data
// (not Prisma). Run GAME_DATA_STATUS_SQL with `prisma.$queryRawUnsafe`; if it
// throws because the schemas don't exist yet, treat that as "not set up".

/** How often the worker checks upstream (Railway cron in apps/sc-data/railway.toml). */
export const GAME_DATA_CHECK_INTERVAL_MIN = 5;
/** No check for this long means the worker isn't running. */
export const GAME_DATA_STALE_AFTER_MIN = 30;

export const GAME_DATA_STATUS_SQL = `
SELECT json_build_object(
  'state', (SELECT row_to_json(s) FROM (
      SELECT commit, build, committed_at, synced_at FROM scdata_raw.state) s),
  'last_check', (SELECT max(started_at) FROM scdata_raw.sync_run),
  'running', (SELECT row_to_json(r) FROM (
      SELECT started_at, trigger FROM scdata_raw.sync_run
      WHERE status = 'running' AND started_at > now() - interval '1 hour'
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
  running: { startedAt: string; trigger: string } | null;
  lastRun: { status: 'success' | 'failed'; trigger: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
  /** The last sync that actually changed something (forced re-checks that found nothing don't count) */
  lastChange: { finishedAt: string | null; added: number; changed: number; removed: number } | null;
  pendingRequest: { requestedAt: string; requestedBy: string | null } | null;
  counts: { items: number; ships: number; contracts: number; blueprints: number; commodities: number } | null;
}

export const GAME_DATA_NOT_SET_UP: GameDataStatus = {
  health: 'not_set_up', commit: null, build: null, committedAt: null, syncedAt: null, lastCheckAt: null,
  running: null, lastRun: null, lastChange: null, pendingRequest: null, counts: null,
};

interface RawStatus {
  state: { commit: string | null; build: string | null; committed_at: string | null; synced_at: string | null } | null;
  last_check: string | null;
  running: { started_at: string; trigger: string } | null;
  last_run: { status: 'success' | 'failed'; trigger: string; started_at: string; finished_at: string | null; error: string | null } | null;
  last_success: { finished_at: string | null; files_added: number | null; files_changed: number | null; files_removed: number | null } | null;
  pending: { requested_at: string; requested_by: string | null } | null;
  counts: Record<string, number | string> | null;
}

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);

/** Turns the row from GAME_DATA_STATUS_SQL (its `status` column) into a GameDataStatus. */
export function parseGameDataStatus(raw: unknown, now: Date = new Date()): GameDataStatus {
  const r = (typeof raw === 'string' ? JSON.parse(raw) : raw) as RawStatus | null;
  if (!r || !r.state?.commit) {
    const empty: GameDataStatus = {
      ...GAME_DATA_NOT_SET_UP,
      lastCheckAt: iso(r?.last_check),
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
  if (now.getTime() - lastCheck > GAME_DATA_STALE_AFTER_MIN * 60_000) return 'stale';
  return 'ok';
}

/** True for "schema/table doesn't exist" errors, i.e. the worker hasn't run yet. */
export function isGameDataMissingError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  const code = e?.meta?.code ?? e?.code;
  return code === '42P01' || code === '3F000' || /does not exist/i.test(e?.message ?? '');
}
