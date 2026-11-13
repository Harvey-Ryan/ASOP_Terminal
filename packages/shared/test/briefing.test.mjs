// v1.36.0: mission briefings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBriefing, parseBriefing, defaultBriefing, briefingSlides, bodyBlocks, briefingSummary, safeImageUrl, forceTotals, groupPeople, briefingRoles, imageRows, BRIEFING_LIMITS } from '../dist/index.js';

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

test('roster sections: groups are cleaned, people come from the role plus typed names', () => {
  const c = sanitizeBriefing({ sections: [{ id: 'r', kind: 'roster', title: 'Teams', bgUrl: 'javascript:alert(1)', bgOpacity: 250, groups: [
    { id: 'g1', title: 'Ironclad crew', roleId: 'role-a', names: 'Destrokk\nmango, Extra', imageUrl: 'https://media.robertsspaceindustries.com/x.jpg', note: 'Ironclad Assault' },
    { id: 'g1', title: 'x'.repeat(99), imageUrl: 'http://evil' },
    ...Array.from({ length: 9 }, () => ({ title: 'more' })),
  ] }, { id: 't', kind: 'text', body: 'b', groups: [{ title: 'no' }], bgUrl: '/uploads/g/bg.png', bgOpacity: '40' }] });
  const [r, t] = c.sections;
  assert.equal(r.groups.length, BRIEFING_LIMITS.groups);
  assert.notEqual(r.groups[1].id, 'g1');
  assert.equal(r.groups[1].title.length, BRIEFING_LIMITS.groupTitle);
  assert.equal(r.groups[1].imageUrl, null);
  assert.equal(r.bgUrl, null);
  assert.equal(r.bgOpacity, 100);
  assert.deepEqual(t.groups, []);
  assert.equal(t.bgUrl, '/uploads/g/bg.png');
  assert.equal(t.bgOpacity, 40);
  assert.equal(briefingSlides(c).length, 3);

  const roles = briefingRoles(JSON.stringify([{ id: 'role-a', name: 'Ironclad', count: 4 }, { name: 'Old role', count: 0 }]), [
    { role: 'role-a', username: 'Destrokk', tentative: false },
    { role: 'role-a', username: 'Maybe Guy', tentative: true },
    { role: 'Old role', username: 'Rook', tentative: false },
  ]);
  assert.deepEqual(roles, [{ id: 'role-a', name: 'Ironclad', count: 4, people: ['Destrokk'] }, { id: 'Old role', name: 'Old role', count: 0, people: ['Rook'] }]);
  assert.deepEqual(groupPeople(r.groups[0], roles), { people: ['Destrokk', 'mango', 'Extra'], slots: 4 });
  assert.deepEqual(groupPeople({ ...r.groups[0], roleId: null, names: '' }, roles), { people: [], slots: null });
  assert.equal(groupPeople({ ...r.groups[0], names: 'a\nb\nc\nd' }, roles).slots, null);
  assert.deepEqual(briefingRoles('not json', []), []);
});

test('image sections: a second picture and text, on the other side', () => {
  const c = sanitizeBriefing({ sections: [
    { id: 'a', kind: 'image', title: 'Map', imageUrl: '/uploads/g/a.png', body: 'Left text', imageUrl2: 'https://x/b.png', body2: 'Right text' },
    { id: 'b', kind: 'image', title: 'Only 2nd', imageUrl2: 'http://bad', body2: 'Just text' },
    { id: 'c', kind: 'text', title: 'T', body: 'x', imageUrl2: '/uploads/g/c.png', body2: 'no' },
  ] });
  const [a, b, t] = c.sections;
  assert.deepEqual(imageRows(a).map((r) => [r.imageUrl, r.body, r.side]), [['/uploads/g/a.png', 'Left text', 'left'], ['https://x/b.png', 'Right text', 'right']]);
  assert.equal(b.imageUrl2, null);
  assert.deepEqual(imageRows(b).map((r) => r.side), ['right']);
  assert.equal(t.imageUrl2, null);
  assert.equal(t.body2, '');
  assert.deepEqual(imageRows(t), []);
  assert.equal(briefingSlides(c).length, 4);
});
