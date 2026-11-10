// ASOP sc-data worker: keeps our own copy of StarCitizenWiki/scunpacked-data.
//
// Each run (Railway cron) does:
//   1. apply schema migrations
//   2. ask GitHub for the upstream head commit (one tiny request)
//   3. if it matches what we hold: log "no_change" and exit
//   4. otherwise, in ONE transaction: stream the tarball, write changed files to
//      scdata_raw.file, delete files gone upstream, rebuild the clean scdata.*
//      tables, record the new commit. Any failure rolls all of it back, so the
//      app only ever sees a complete build.
//
// Env:
//   DATABASE_URL              required
//   SC_DATA_REPO              default StarCitizenWiki/scunpacked-data
//   SC_DATA_BRANCH            default master
//   GITHUB_TOKEN              optional, raises the GitHub API limit for commit details
//   SC_DATA_FORCE=1           re-check every file even if the head commit is unchanged
//   SC_DATA_ALLOW_MASS_DELETE=1  allow removing >25% of files in one run
//   SC_DATA_TARBALL_FILE      testing: read this local .tar.gz instead of downloading
//   SC_DATA_COMMIT            testing: use this commit id instead of asking GitHub

import pg from 'pg';
import { migrations } from './migrations.js';
import { getHeadCommit, getCommitInfo, openTarball, type UpstreamConfig } from './upstream.js';
import { syncRaw } from './raw.js';
import { rebuildClean, unmappedPaths } from './clean.js';

const LOCK_KEY = 0x5c_da7a; // arbitrary; one worker at a time across all replicas
const log = (msg: string) => console.log(`[sc-data] ${msg}`);

async function migrate(client: pg.PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS scdata_raw');
  await client.query(
    'CREATE TABLE IF NOT EXISTS scdata_raw.schema_migration (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set((await client.query<{ id: string }>('SELECT id FROM scdata_raw.schema_migration')).rows.map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    log(`Applying migration ${m.id}`);
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO scdata_raw.schema_migration (id) VALUES ($1)', [m.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const cfg: UpstreamConfig = {
    repo: process.env['SC_DATA_REPO'] ?? 'StarCitizenWiki/scunpacked-data',
    branch: process.env['SC_DATA_BRANCH'] ?? 'master',
    token: process.env['GITHUB_TOKEN'] || undefined,
  };
  const force = process.env['SC_DATA_FORCE'] === '1';
  const trigger = process.env['SC_DATA_TRIGGER'] ?? 'cron';

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const locked = (await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0]?.ok;
    if (!locked) {
      log('Another sync is running; exiting.');
      return 0;
    }

    await migrate(client);

    const head = process.env['SC_DATA_COMMIT'] ?? (await getHeadCommit(cfg));
    const state = (await client.query<{ commit: string | null }>('SELECT commit FROM scdata_raw.state')).rows[0];
    log(`Upstream ${cfg.repo}@${cfg.branch} is at ${head.slice(0, 12)}; we hold ${state?.commit?.slice(0, 12) ?? 'nothing'}`);

    if (state?.commit === head && !force) {
      await client.query(
        `INSERT INTO scdata_raw.sync_run (trigger, status, upstream_commit, finished_at) VALUES ($1, 'no_change', $2, now())`,
        [trigger, head],
      );
      log('No upstream change; nothing to do.');
      return 0;
    }

    const info = process.env['SC_DATA_COMMIT']
      ? { build: process.env['SC_DATA_BUILD'] ?? null, committedAt: null }
      : await getCommitInfo(cfg, head);
    const runId = (
      await client.query<{ id: string }>(
        `INSERT INTO scdata_raw.sync_run (trigger, status, upstream_commit, build) VALUES ($1, 'running', $2, $3) RETURNING id`,
        [trigger, head, info.build],
      )
    ).rows[0]!.id;

    const started = Date.now();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = 0');

      log(`Syncing ${info.build ?? head.slice(0, 12)}…`);
      const tarball = await openTarball(cfg, head, process.env['SC_DATA_TARBALL_FILE']);
      const raw = await syncRaw(client, tarball, head, { allowMassDelete: process.env['SC_DATA_ALLOW_MASS_DELETE'] === '1' });
      log(`Raw: ${raw.seen} files seen, ${raw.added} added, ${raw.changed} changed, ${raw.removed} removed, ${raw.invalid.length} invalid`);
      if (raw.invalid.length) log(`Invalid (kept previous version, if any): ${raw.invalid.slice(0, 20).join(', ')}`);

      const counts = await rebuildClean(client, { commit: head, build: info.build, committedAt: info.committedAt });
      log(`Clean: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      const unmapped = unmappedPaths(raw.paths);
      if (unmapped.length) log(`New upstream files with no clean table yet (still stored raw): ${unmapped.join(', ')}`);

      await client.query(
        'UPDATE scdata_raw.state SET commit = $1, build = $2, committed_at = $3, synced_at = now()',
        [head, info.build, info.committedAt],
      );
      await client.query(
        `UPDATE scdata_raw.sync_run SET status = 'success', finished_at = now(), files_seen = $2, files_added = $3,
           files_changed = $4, files_removed = $5, files_invalid = $6, invalid_paths = $7, unmapped_paths = $8,
           clean_counts = $9 WHERE id = $1`,
        [runId, raw.seen, raw.added, raw.changed, raw.removed, raw.invalid.length, raw.invalid, unmapped, counts],
      );
      await client.query('COMMIT');
      log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return 0;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      await client.query(
        `UPDATE scdata_raw.sync_run SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
        [runId, message],
      );
      console.error(`[sc-data] Sync failed, nothing was changed: ${message}`);
      return 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[sc-data] Fatal:', err);
    process.exit(1);
  },
);
