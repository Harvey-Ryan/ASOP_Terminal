// Streams the upstream tarball and brings scdata_raw.file in line with it.
//
// Only files whose bytes changed are written. JSON is never parsed in Node:
// Postgres parses it on the ::jsonb cast, which keeps memory flat even for the
// 68 MB items.json. A file Postgres rejects (e.g. a Git LFS pointer) is skipped
// and reported, and its previous version, if any, is kept.

import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import tar from 'tar-stream';

export interface RawResult {
  seen: number;
  added: number;
  changed: number;
  removed: number;
  invalid: string[];
  paths: string[];
}

interface Pending {
  path: string;
  sha: string;
  size: number;
  data: Buffer;
  isNew: boolean;
}

// Small files are written in batches; anything over LARGE_FILE goes alone as raw
// bytes (no text conversion or array escaping), which keeps peak memory near
// the size of the biggest file instead of several copies of it.
const BATCH_BYTES = 16 * 1024 * 1024;
const LARGE_FILE = 4 * 1024 * 1024;
const BATCH_FILES = 500;
// Refuse to delete more than this share of our files in one run: a truncated
// or wrong tarball must not wipe the copy.
const MAX_REMOVE_SHARE = 0.25;

const UPSERT = `
  INSERT INTO scdata_raw.file (path, sha256, size_bytes, content, first_seen_commit, changed_commit, changed_at)
  SELECT p, s, z, c::jsonb, $5, $5, now()
  FROM unnest($1::text[], $2::text[], $3::int[], $4::text[]) AS t(p, s, z, c)
  ON CONFLICT (path) DO UPDATE SET
    sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content,
    changed_commit = EXCLUDED.changed_commit, changed_at = EXCLUDED.changed_at`;

const UPSERT_ONE = `
  INSERT INTO scdata_raw.file (path, sha256, size_bytes, content, first_seen_commit, changed_commit, changed_at)
  VALUES ($1, $2, $3, convert_from($4::bytea, 'UTF8')::jsonb, $5, $5, now())
  ON CONFLICT (path) DO UPDATE SET
    sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content,
    changed_commit = EXCLUDED.changed_commit, changed_at = EXCLUDED.changed_at`;

export async function syncRaw(
  client: PoolClient,
  tarball: Readable,
  commit: string,
  opts: { allowMassDelete?: boolean } = {},
): Promise<RawResult> {
  const existing = new Map<string, string>();
  const rows = await client.query<{ path: string; sha256: string }>('SELECT path, sha256 FROM scdata_raw.file');
  for (const r of rows.rows) existing.set(r.path, r.sha256);

  const seen = new Set<string>();
  const result: RawResult = { seen: 0, added: 0, changed: 0, removed: 0, invalid: [], paths: [] };
  let batch: Pending[] = [];
  let batchBytes = 0;

  async function write(files: Pending[]): Promise<Pending[]> {
    if (files.length === 1) {
      const f = files[0]!;
      await client.query(UPSERT_ONE, [f.path, f.sha, f.size, f.data, commit]);
    } else {
      await client.query(UPSERT, [
        files.map((f) => f.path), files.map((f) => f.sha), files.map((f) => f.size),
        files.map((f) => f.data.toString('utf8')), commit,
      ]);
    }
    return files;
  }

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const files = batch;
    batch = [];
    batchBytes = 0;
    let written: Pending[] = [];
    await client.query('SAVEPOINT batch');
    try {
      written = await write(files);
      await client.query('RELEASE SAVEPOINT batch');
    } catch {
      // Something in the batch isn't valid JSON: retry file by file to find it.
      await client.query('ROLLBACK TO SAVEPOINT batch');
      for (const f of files) {
        await client.query('SAVEPOINT one');
        try {
          await write([f]);
          await client.query('RELEASE SAVEPOINT one');
          written.push(f);
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT one');
          result.invalid.push(f.path);
        }
      }
      await client.query('RELEASE SAVEPOINT batch');
    }
    for (const f of written) {
      if (f.isNew) result.added++;
      else result.changed++;
    }
    await logChanges(client, commit, written.map((f) => [f.path, f.isNew ? 'added' : 'changed']));
  }

  const extract = tar.extract();
  extract.on('entry', (header, stream, next) => {
    // GitHub tarballs put everything under "<repo>-<sha>/".
    const path = header.name.split('/').slice(1).join('/');
    if (header.type !== 'file' || !path.endsWith('.json')) {
      stream.on('end', next);
      stream.resume();
      return;
    }
    let chunks: Buffer[] = [];
    stream.on('data', (c: unknown) => chunks.push(c as Buffer));
    stream.on('error', next);
    stream.on('end', () => {
      void (async () => {
        let buf = Buffer.concat(chunks);
        chunks = [];
        seen.add(path);
        const sha = createHash('sha256').update(buf).digest('hex');
        const prev = existing.get(path);
        if (prev !== sha) {
          // Strip a UTF-8 byte-order mark; Postgres won't parse JSON with one.
          if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
          const file: Pending = { path, sha, size: buf.length, data: buf, isNew: prev === undefined };
          if (buf.length >= LARGE_FILE) {
            await flush();          // keep order: pending small files first
            batch = [file];
            await flush();          // then this one on its own
          } else {
            batch.push(file);
            batchBytes += buf.length;
            if (batchBytes >= BATCH_BYTES || batch.length >= BATCH_FILES) await flush();
          }
        }
      })().then(() => next(), next);
    });
  });

  await pipeline(tarball, createGunzip(), extract);
  await flush();

  result.seen = seen.size;
  result.paths = [...seen];

  const gone = [...existing.keys()].filter((p) => !seen.has(p));
  if (!opts.allowMassDelete && gone.length > 0 && existing.size > 0 && gone.length / existing.size > MAX_REMOVE_SHARE) {
    throw new Error(
      `Upstream is missing ${gone.length} of our ${existing.size} files; refusing to delete that many. ` +
        'If this is real, run once with SC_DATA_ALLOW_MASS_DELETE=1.',
    );
  }
  if (gone.length > 0) {
    await client.query('DELETE FROM scdata_raw.file WHERE path = ANY($1::text[])', [gone]);
    await logChanges(client, commit, gone.map((p) => [p, 'removed']));
    result.removed = gone.length;
  }
  return result;
}

async function logChanges(client: PoolClient, commit: string, changes: [string, string][]): Promise<void> {
  if (changes.length === 0) return;
  await client.query(
    `INSERT INTO scdata_raw.file_change (commit, path, kind)
     SELECT $1, p, k FROM unnest($2::text[], $3::text[]) AS t(p, k)`,
    [commit, changes.map((c) => c[0]), changes.map((c) => c[1])],
  );
}
