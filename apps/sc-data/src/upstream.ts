// Talking to the upstream GitHub repo.
//
// - Head commit: git's smart-HTTP ref advertisement (what `git ls-remote` uses).
//   One small request, no API rate limit, no token needed.
// - Commit details (build name, date): GitHub REST API, only when the head moved.
//   Unauthenticated limit is 60/hour; set GITHUB_TOKEN to raise it. Optional:
//   if it fails we sync anyway without a build name.
// - Content: the commit's tarball from codeload, streamed (never held in memory).

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export interface UpstreamConfig {
  repo: string;   // owner/name
  branch: string;
  token?: string;
}

export async function getHeadCommit(cfg: UpstreamConfig): Promise<string> {
  const url = `https://github.com/${cfg.repo}.git/info/refs?service=git-upload-pack`;
  const res = await fetch(url, { headers: { 'User-Agent': 'asop-sc-data' } });
  if (!res.ok) throw new Error(`Head check failed: HTTP ${res.status} from ${url}`);
  const body = await res.text();
  const ref = `refs/heads/${cfg.branch}`;
  const m = new RegExp(`([0-9a-f]{40}) ${ref.replace(/\//g, '\\/')}(?:\\u0000|\\n|$)`).exec(body);
  if (!m?.[1]) throw new Error(`Branch ${cfg.branch} not found in ${cfg.repo}`);
  return m[1];
}

export async function getCommitInfo(
  cfg: UpstreamConfig,
  sha: string,
): Promise<{ build: string | null; committedAt: Date | null }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/commits/${sha}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'asop-sc-data',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { commit?: { message?: string; committer?: { date?: string } } };
    // Upstream commit messages are the game build, e.g. "4.10.2-LIVE.12881860".
    const build = body.commit?.message?.split('\n')[0]?.trim() || null;
    const date = body.commit?.committer?.date;
    return { build, committedAt: date ? new Date(date) : null };
  } catch (err) {
    console.warn(`[sc-data] Could not read commit details (${(err as Error).message}); continuing without build name`);
    return { build: null, committedAt: null };
  }
}

/** Gzipped tar of the repo at `sha`. SC_DATA_TARBALL_FILE overrides (local testing). */
export async function openTarball(cfg: UpstreamConfig, sha: string, localFile?: string): Promise<Readable> {
  if (localFile) return createReadStream(localFile);
  const url = `https://codeload.github.com/${cfg.repo}/tar.gz/${sha}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'asop-sc-data' } });
  if (!res.ok || !res.body) throw new Error(`Tarball download failed: HTTP ${res.status} from ${url}`);
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
}
