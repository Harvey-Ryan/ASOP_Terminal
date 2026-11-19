#!/usr/bin/env node
// Tags every version on master that has no tag yet and publishes a GitHub
// Release for it, with the patch notes of the commits since the version before
// (run by .github/workflows/release.yml on each push to master; CLAUDE.md,
// "Versioning").
//
//   node scripts/release.mjs             # tag, push tags, create releases (needs GH_TOKEN)
//   node scripts/release.mjs --dry-run   # print what it would do
//
// Covers versions from FIRST_VERSION on (v1.28.0 and earlier were tagged by
// hand without Releases). A version is skipped once it has both its tag and its
// Release, so a run that stopped half-way is finished by the next one.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectNotes, compareVersions, releaseTitle, renderNotes, splitLog, versionStarts } from './releaseNotes.mjs';

const FIRST_VERSION = '1.28.1';
const dry = process.argv.includes('--dry-run');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const git = (...args) => run('git', args);

const tags = new Set(git('tag', '--list', 'v*').split('\n').filter(Boolean));
const released = new Set(dry ? [] : JSON.parse(run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'])).map((r) => r.tagName));
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The merge commits on master that changed package.json, oldest first, with the version each one set.
const changes = git('log', '--first-parent', '--reverse', '--format=%H %cI', 'HEAD', '--', 'package.json').split('\n').filter(Boolean).map((line) => {
  const [sha, date] = line.split(' ');
  let version = null;
  try { version = JSON.parse(git('show', `${sha}:package.json`)).version ?? null; } catch { /* unreadable: skip */ }
  return { sha, date, version };
});
const starts = versionStarts(changes);

const todo = starts.filter((s) => compareVersions(s.version, FIRST_VERSION) >= 0 && !(tags.has(`v${s.version}`) && released.has(`v${s.version}`)));
if (!todo.length) {
  console.log(`Nothing to release: v${starts.at(-1)?.version ?? '?'} and everything before it are tagged and released.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'asop-release-'));
for (const [i, rel] of todo.entries()) {
  const tag = `v${rel.version}`;
  // Notes cover everything since the version before this one on master.
  const before = starts[starts.indexOf(rel) - 1];
  const range = before ? `${before.sha}..${rel.sha}` : rel.sha;
  const commits = splitLog(git('log', '--reverse', '--format=%H%n%B%n==END==', range));
  const notes = collectNotes(commits);
  const title = releaseTitle(rel.version, rel.date);
  const body = renderNotes(notes);
  console.log(`\n${tag} at ${rel.sha.slice(0, 7)} (${commits.length} commits since ${before ? `v${before.version}` : 'the start'})`);
  if (dry) { console.log(`# ${title}\n\n${body}`); continue; }

  if (!tags.has(tag)) {
    git('tag', '-a', tag, rel.sha, '-m', title);
    git('push', 'origin', tag);
  }
  if (!released.has(tag)) {
    const file = join(dir, `${tag}.md`);
    writeFileSync(file, body);
    // Only the newest is marked latest, so a back-fill doesn't jump around.
    run('gh', ['release', 'create', tag, '--verify-tag', '--title', title, '--notes-file', file, `--latest=${i === todo.length - 1}`]);
  }
  console.log(`Released ${tag}.`);
  // GitHub limits how fast content is created; a back-fill makes dozens.
  if (todo.length > 3) pause(3000);
}
