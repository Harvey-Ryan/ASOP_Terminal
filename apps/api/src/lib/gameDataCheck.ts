// "Check now" for the game data (v1.38.0): asks GitHub, right away, whether
// scunpacked-data has moved past the commit we hold. Nothing is downloaded and
// nothing is written: if there's something new, the sc-data worker's next
// scheduled run syncs it (it always does when the head commit moves).
//
// The head lookup mirrors apps/sc-data/src/upstream.ts (git's ref
// advertisement: one small request, no API limit); commit details come from
// GitHub's REST API only when the head has moved.

import { prisma } from './prisma.js';

export interface GameDataCheckResult {
  checkedAt: string;
  upToDate: boolean;
  /** What GitHub has now */
  upstreamCommit: string;
  upstreamBuild: string | null;
  upstreamCommittedAt: string | null;
}

const repo = () => process.env['SC_DATA_REPO'] ?? 'StarCitizenWiki/scunpacked-data';
const branch = () => process.env['SC_DATA_BRANCH'] ?? 'master';

export async function upstreamHead(): Promise<string> {
  const url = `https://github.com/${repo()}.git/info/refs?service=git-upload-pack`;
  const res = await fetch(url, { headers: { 'User-Agent': 'asop-api' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return parseHeadRef(await res.text(), branch());
}

/** The branch's commit from git's ref advertisement. */
export function parseHeadRef(body: string, branchName: string): string {
  const ref = `refs/heads/${branchName}`.replace(/[/.]/g, (c) => `\\${c}`);
  const m = new RegExp(`([0-9a-f]{40}) ${ref}(?:\\u0000|\\n|$)`).exec(body);
  if (!m?.[1]) throw new Error(`Branch ${branchName} not found upstream`);
  return m[1];
}

async function commitInfo(sha: string): Promise<{ build: string | null; committedAt: string | null }> {
  try {
    const token = process.env['GITHUB_TOKEN'];
    const res = await fetch(`https://api.github.com/repos/${repo()}/commits/${sha}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'asop-api', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { commit?: { message?: string; committer?: { date?: string } } };
    return { build: body.commit?.message?.split('\n')[0]?.trim() || null, committedAt: body.commit?.committer?.date ?? null };
  } catch (err) {
    console.warn(`[game-data/check] Could not read commit details: ${(err as Error).message}`);
    return { build: null, committedAt: null };
  }
}

let last: { at: number; result: GameDataCheckResult } | null = null;
const REUSE_MS = 30_000;

/** Compares GitHub's head with what we hold. Answers repeated clicks within 30 s from the last check. */
export async function checkUpstreamNow(): Promise<GameDataCheckResult> {
  if (last && Date.now() - last.at < REUSE_MS) return last.result;
  const [head, held] = await Promise.all([
    upstreamHead(),
    prisma.$queryRawUnsafe<{ commit: string | null; build: string | null; committed_at: Date | null }[]>(
      'SELECT commit, build, committed_at FROM scdata_raw.state',
    ),
  ]);
  const state = held[0];
  const upToDate = !!state?.commit && state.commit === head;
  const info = upToDate
    ? { build: state?.build ?? null, committedAt: state?.committed_at ? new Date(state.committed_at).toISOString() : null }
    : await commitInfo(head);
  const result: GameDataCheckResult = {
    checkedAt: new Date().toISOString(),
    upToDate,
    upstreamCommit: head,
    upstreamBuild: info.build,
    upstreamCommittedAt: info.committedAt,
  };
  last = { at: Date.now(), result };
  return result;
}

export function forgetLastCheckForTests(): void {
  last = null;
}
