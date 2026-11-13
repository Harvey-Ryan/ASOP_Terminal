// v1.36.0: mission briefings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBriefing, parseBriefing, defaultBriefing, briefingSlides, bodyBlocks, briefingSummary, safeImageUrl, forceTotals, BRIEFING_LIMITS } from '../dist/index.js';

test('a new briefing has the usual sections, all empty and so not shown', () => {
  const d = defaultBriefing();
  assert.deepEqual(d.sections.map((s) => s.title), ['Situation', 'Area of operations', 'Phases', 'Force', 'Comms & callsigns', 'Rules of engagement']);
  assert.deepEqual(briefingSlides(d).map((s) => s.kind === 'title' ? 'title' : s.section.title), ['title']);
});

test('whatever comes in is cut down to a valid briefing', () => {
  const c = sanitizeBriefing({
    objective: 'x'.repeat(1000),
    facts: Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: `  v \n ${i}  ` })),
    sections: [{ id: 'a b!', kind: 'image', title: 'Map', body: 'b', imageUrl: '/uploads/../../etc/passwd' }, { id: 'ab', kind: 'image', imageUrl: '/uploads/g/map.png' }, 'junk'],
    appearance: { logoPosition: 'TOP_RIGHT', watermark: 'NOPE', watermarkStrength: -5, banner: 'b'.repeat(99), allyLogos: 'yes' },
  });
  assert.equal(c.objective.length, BRIEFING_LIMITS.objective);
  assert.equal(c.facts.length, 4);
  assert.equal(c.facts[0].value, 'v 0');
  assert.deepEqual(c.sections.map((s) => [s.id, s.kind, s.imageUrl]), [['ab', 'image', null], [c.sections[1].id, 'image', '/uploads/g/map.png'], [c.sections[2].id, 'text', null]]);
  assert.notEqual(c.sections[1].id, 'ab');
  assert.deepEqual(c.appearance, { logoUrl: null, allyLogos: true, logoPosition: 'TOP_RIGHT', watermark: 'CORNER', watermarkStrength: 0, banner: 'b'.repeat(24) });
  assert.deepEqual(parseBriefing('not json').sections, []);
});

test('image links: our uploads or https only', () => {
  assert.equal(safeImageUrl('/uploads/g/a.png'), '/uploads/g/a.png');
  assert.equal(safeImageUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
  for (const bad of ['http://x/a.png', 'javascript:alert(1)', 'data:image/png;base64,xx', '/uploads/../x', 'https://x/"onerror=1']) assert.equal(safeImageUrl(bad), null, bad);
});

test('bodies: paragraphs and bullet lists; the roster summary is the objective', () => {
  assert.deepEqual(bodyBlocks('Intro\n- one\n* two\n\nOutro'), [{ kind: 'p', text: 'Intro' }, { kind: 'ul', items: ['one', 'two'] }, { kind: 'p', text: 'Outro' }]);
  assert.equal(briefingSummary({ ...defaultBriefing(), objective: ' Retake\n the hangars. ' }), 'Retake the hangars.');
  assert.equal(briefingSummary({ ...defaultBriefing(), objective: 'y'.repeat(400) }).length, 300);
});

test('ship sections hold only what the organisers picked', () => {
  const c = sanitizeBriefing({ sections: [
    { id: 'f', kind: 'fleet', title: 'Force', ships: [
      { shipId: 'rsi-1', name: 'Idris-P', count: 1, crew: 28, focus: 'Frigate', note: 'Flagship' },
      { shipId: 'rsi-2', name: 'Cutlass Black', count: '3', crew: 2, note: 'x'.repeat(200) },
      { shipId: 'rsi-1', name: 'dupe' }, { name: 'no id' }, { shipId: 'rsi-3', name: 'Gladius', count: 0, crew: -1 },
    ] },
    { id: 't', kind: 'text', title: 'T', body: 'b', ships: [{ shipId: 'rsi-1', name: 'x' }] },
  ] });
  const [f, t] = c.sections;
  assert.deepEqual(f.ships.map((s) => [s.name, s.count, s.crew]), [['Idris-P', 1, 28], ['Cutlass Black', 3, 2], ['Gladius', 1, null]]);
  assert.equal(f.ships[1].note.length, BRIEFING_LIMITS.shipNote);
  assert.deepEqual(t.ships, []);
  assert.deepEqual(forceTotals(f.ships), { ships: 5, seats: 35 });
  // an empty ship section isn't a slide; one with ships is
  assert.equal(briefingSlides(sanitizeBriefing({ sections: [{ id: 'f', kind: 'fleet', title: 'Force' }] })).length, 1);
  assert.equal(briefingSlides(c).length, 3);
});
