import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, icsDate, icsText, icsFold } from '../dist/index.js';

test('dates are UTC basic format', () => {
  assert.equal(icsDate(new Date('2026-11-13T15:04:05.678Z')), '20261113T150405Z');
});

test('text escapes', () => {
  assert.equal(icsText('a;b,c\\d\nnext'), 'a\\;b\\,c\\\\d\\nnext');
});

test('long lines fold at 75 bytes without splitting characters', () => {
  const line = `DESCRIPTION:${'é'.repeat(80)}`;
  const folded = icsFold(line);
  const enc = new TextEncoder();
  for (const part of folded.split('\r\n')) assert.ok(enc.encode(part).length <= 75, part);
  assert.equal(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join(''), line);
  assert.equal(icsFold('SHORT:x'), 'SHORT:x');
});

test('a calendar with one event', () => {
  const ics = buildIcs('ASOP events', [{
    uid: 'e1@asop', start: new Date('2026-11-13T15:00:00Z'), end: new Date('2026-11-13T17:00:00Z'),
    summary: 'Mining op, Aaron Halo', description: 'Your role: Miner', location: 'Lorville', updated: new Date('2026-11-10T00:00:00Z'),
  }], new Date('2026-11-11T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const l of ['UID:e1@asop', 'DTSTART:20261113T150000Z', 'DTEND:20261113T170000Z', 'SUMMARY:Mining op\\, Aaron Halo', 'LOCATION:Lorville', 'X-WR-CALNAME:ASOP events', 'DTSTAMP:20261111T000000Z', 'STATUS:CONFIRMED']) {
    assert.ok(ics.includes(`\r\n${l}\r\n`), l);
  }
  assert.ok(!ics.includes('URL:'));
});
