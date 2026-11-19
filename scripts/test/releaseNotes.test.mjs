import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNotes, compareVersions, parsePatchNotes, releaseTitle, renderNotes, splitLog, versionStarts } from '../releaseNotes.mjs';

const msg = (body) => `feat(x): something\n\nTechnical body.\n\n${body}\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://example.test/s`;

test('reads sections, bullets, sub-points and wrapped lines, and stops at the trailers', () => {
  const n = parsePatchNotes(msg('Patch notes:\n[Loot Draft Queue]\n* Every item has a + button\n  to add it.\n   * Sub-point one.\n\n[Bug Fixes]\n* Fixed a thing.'));
  assert.equal(n.kind, 'notes');
  assert.deepEqual(n.sections, [
    { title: 'Loot Draft Queue', bullets: [{ text: 'Every item has a + button to add it.', subs: ['Sub-point one.'] }] },
    { title: 'Bug Fixes', bullets: [{ text: 'Fixed a thing.', subs: [] }] },
  ]);
});

test('"Patch notes: none" and a missing block are told apart', () => {
  assert.equal(parsePatchNotes(msg('Patch notes: none')).kind, 'none');
  assert.equal(parsePatchNotes('fix: typo\n\nNo block here.').kind, 'missing');
});

test('collects a release: same sections merged, duplicates dropped, Bug Fixes last, merges skipped', () => {
  const commits = splitLog([
    'aaa1111', msg('Patch notes:\n[Bug Fixes]\n* Fix one.\n\n[Mining]\n* New tab.'), '==END==',
    'bbb2222', msg('Patch notes:\n[Mining]\n* New tab.\n* Scanner places.'), '==END==',
    'ccc3333', msg('Patch notes: none'), '==END==',
    'ddd4444', 'chore: bump\n\nNo notes.', '==END==',
    'eee5555', 'Merge pull request #1 from x/y\n\nfeat', '==END==',
  ].join('\n'));
  assert.equal(commits.length, 5);
  const notes = collectNotes(commits);
  assert.deepEqual(notes.sections.map((s) => [s.title, s.bullets.map((b) => b.text)]), [
    ['Mining', ['New tab.', 'Scanner places.']],
    ['Bug Fixes', ['Fix one.']],
  ]);
  assert.deepEqual(notes.missing.map((c) => c.sha), ['ddd4444']);
  const md = renderNotes(notes);
  assert.match(md, /^### Mining\n\n- New tab\.\n- Scanner places\.\n\n### Bug Fixes\n\n- Fix one\.\n/);
  assert.match(md, /ddd4444 chore: bump/);
});

test('a release with nothing for players still says so', () => {
  assert.match(renderNotes({ sections: [], missing: [] }), /No player-facing changes/);
});

test('versions: order, first appearance on master, title date in Central time', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.55.0', '1.55.0'), 0);
  const starts = versionStarts([
    { sha: 'a', version: '1.53.0', date: '' },
    { sha: 'b', version: '1.54.0', date: '' },
    { sha: 'c', version: '1.54.0', date: '' },
    { sha: 'd', version: null, date: '' },
    { sha: 'e', version: '1.55.0', date: '' },
  ]);
  assert.deepEqual(starts.map((s) => [s.sha, s.version]), [['a', '1.53.0'], ['b', '1.54.0'], ['e', '1.55.0']]);
  // 02:30 UTC on the 20th is still the 19th in Texas.
  assert.equal(releaseTitle('1.55.0', '2026-11-20T02:30:00Z'), 'Patch Notes — v1.55.0 — November 19');
});
