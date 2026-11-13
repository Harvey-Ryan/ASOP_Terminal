// v1.35.0: StarStrings releases from GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStarStringsRelease, starStringsKey, starStringsPostedValue, fileSize, STARSTRINGS_LIVE_PAGE } from '../dist/index.js';

const gh = {
  tag_name: 'latest', name: 'SC LIVE Build (release-2026-10-09-292e6be)', draft: false, prerelease: false,
  published_at: '2026-10-09T19:31:00Z', html_url: 'https://github.com/MrKraken/StarStrings/releases/tag/latest',
  assets: [
    { name: 'readme.md', browser_download_url: 'https://github.com/MrKraken/StarStrings/releases/download/latest/readme.md', size: 900 },
    { name: 'StarStrings-LIVE.zip', browser_download_url: 'https://github.com/MrKraken/StarStrings/releases/download/latest/StarStrings-LIVE.zip', size: 2_401_234 },
  ],
};

test('a release: build id, the LIVE zip, its size', () => {
  const r = parseStarStringsRelease(gh);
  assert.deepEqual(r, {
    name: 'SC LIVE Build (release-2026-10-09-292e6be)', build: 'release-2026-10-09-292e6be', publishedAt: '2026-10-09T19:31:00.000Z',
    pageUrl: 'https://github.com/MrKraken/StarStrings/releases/tag/latest',
    downloadUrl: 'https://github.com/MrKraken/StarStrings/releases/download/latest/StarStrings-LIVE.zip',
    fileName: 'StarStrings-LIVE.zip', sizeBytes: 2_401_234,
  });
  assert.equal(starStringsKey(r), 'release-2026-10-09-292e6be@2026-10-09T19:31:00.000Z');
  assert.equal(starStringsPostedValue('123', starStringsKey(r)), '123|release-2026-10-09-292e6be@2026-10-09T19:31:00.000Z');
  assert.equal(fileSize(r.sizeBytes), '2.3 MB');
  assert.equal(fileSize(900), '1 KB');
});

test('no zip: the release page; odd links are ignored; drafts and junk are not releases', () => {
  const r = parseStarStringsRelease({ ...gh, name: 'Something', html_url: 'https://evil.example/x', assets: [{ name: 'x.zip', browser_download_url: 'https://evil.example/x.zip' }] });
  assert.equal(r.build, null);
  assert.equal(r.pageUrl, STARSTRINGS_LIVE_PAGE);
  assert.equal(r.downloadUrl, STARSTRINGS_LIVE_PAGE);
  assert.equal(r.fileName, null);
  assert.equal(parseStarStringsRelease({ ...gh, draft: true }), null);
  assert.equal(parseStarStringsRelease({ message: 'Not Found' }), null);
  assert.equal(parseStarStringsRelease(null), null);
  // Republished under the same name: the new publish time makes it new.
  assert.notEqual(starStringsKey(parseStarStringsRelease(gh)), starStringsKey(parseStarStringsRelease({ ...gh, published_at: '2026-10-20T00:00:00Z' })));
});
