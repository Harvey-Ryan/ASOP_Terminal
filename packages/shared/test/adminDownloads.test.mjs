import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOWNLOAD_CHART_DAYS, isDownloadItem, isDownloadSource, summariseDownloads, utcDay } from '../dist/index.js';

const now = new Date('2026-11-20T15:00:00Z');

test('only known items and pages are accepted', () => {
  assert.equal(isDownloadItem('rockcrawler'), true);
  assert.equal(isDownloadItem('RockCrawler'), false);
  assert.equal(isDownloadItem(undefined), false);
  assert.equal(isDownloadSource('tools'), true);
  assert.equal(isDownloadSource('dashboard'), true);
  assert.equal(isDownloadSource('elsewhere'), false);
});

test('UTC days', () => {
  assert.equal(utcDay(new Date('2026-11-20T23:59:59Z')), '2026-11-20');
  // 11 p.m. in Chicago on the 20th is already the 21st in UTC.
  assert.equal(utcDay(new Date('2026-11-20T23:00:00-06:00')), '2026-11-21');
});

test('nothing counted yet: zeros, every day present, no start date', () => {
  const s = summariseDownloads('rockcrawler', [], now);
  assert.deepEqual(
    { today: s.today, last7d: s.last7d, last30d: s.last30d, allTime: s.allTime, since: s.since },
    { today: 0, last7d: 0, last30d: 0, allTime: 0, since: null },
  );
  assert.deepEqual(s.bySource, { tools: 0, dashboard: 0 });
  assert.equal(s.days.length, DOWNLOAD_CHART_DAYS);
  assert.equal(s.days[0].day, '2026-10-22');
  assert.equal(s.days.at(-1).day, '2026-11-20');
  assert.ok(s.days.every((d) => d.total === 0 && d.tools === 0 && d.dashboard === 0));
});

test('today, 7 days, 30 days and all time count the right days', () => {
  const rows = [
    { day: '2026-11-20', source: 'tools', count: 3 }, // today
    { day: '2026-11-20', source: 'dashboard', count: 1 },
    { day: '2026-11-14', source: 'tools', count: 2 }, // 6 days ago: inside 7 days
    { day: '2026-11-13', source: 'tools', count: 5 }, // 7 days ago: outside 7 days
    { day: '2026-10-22', source: 'dashboard', count: 4 }, // 29 days ago: first chart day
    { day: '2026-10-21', source: 'tools', count: 10 }, // 30 days ago: all time only
  ];
  const s = summariseDownloads('rockcrawler', rows, now);
  assert.equal(s.today, 4);
  assert.equal(s.last7d, 6);
  assert.equal(s.last30d, 15);
  assert.equal(s.allTime, 25);
  assert.deepEqual(s.bySource, { tools: 20, dashboard: 5 });
  assert.equal(s.since, '2026-10-21');
  assert.deepEqual(s.days.at(-1), { day: '2026-11-20', total: 4, tools: 3, dashboard: 1 });
  assert.deepEqual(s.days[0], { day: '2026-10-22', total: 4, tools: 0, dashboard: 4 });
  assert.equal(
    s.days.reduce((n, d) => n + d.total, 0),
    s.last30d,
  );
});

test('rows from an unknown page or with no count are ignored', () => {
  const s = summariseDownloads(
    'rockcrawler',
    [
      { day: '2026-11-20', source: 'elsewhere', count: 9 },
      { day: '2026-11-20', source: 'tools', count: 0 },
      { day: '2026-11-19', source: 'tools', count: 1 },
    ],
    now,
  );
  assert.equal(s.allTime, 1);
  assert.equal(s.since, '2026-11-19');
});
