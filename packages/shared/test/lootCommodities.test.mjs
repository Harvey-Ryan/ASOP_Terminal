import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCommodityItem,
  gearPickCount,
  gearItemsLeft,
  commoditiesWaiting,
  snakeIndex,
  commodityRollAssignments,
  commodityShares,
  commodityShareLabel,
  chunkBlocks,
} from '../dist/index.js';

// Small seeded random (mulberry32) so rolls are repeatable.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = [
  { userId: 'd', username: 'Destrokk' },
  { userId: 'a', username: 'ArcSolo3' },
  { userId: 'm', username: 'Mango' },
  { userId: 'p', username: 'Drath Pie' },
];

test('a line with a QL is a commodity; gear has none', () => {
  assert.equal(isCommodityItem({ qualityLevel: 800 }), true);
  assert.equal(isCommodityItem({ qualityLevel: 0 }), true);
  assert.equal(isCommodityItem({ qualityLevel: null }), false);
  assert.equal(isCommodityItem({ qualityLevel: undefined }), false);
});

test('snake picks and gear left count gear lines only', () => {
  const items = [
    { qualityLevel: null, assignments: [1] },
    { qualityLevel: null, assignments: [] },
    { qualityLevel: 700, assignments: [1, 2, 3, 4, 5] },
    { qualityLevel: 500, assignments: [] },
  ];
  assert.equal(gearPickCount(items), 1);
  assert.equal(gearItemsLeft(items), 1);
  assert.equal(commoditiesWaiting(items), true);
  assert.equal(commoditiesWaiting(items.slice(0, 3)), false);
});

test('snakeIndex goes there and back', () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, i) => snakeIndex(i, 4)),
    [0, 1, 2, 3, 3, 2, 1, 0, 0],
  );
});

test('every unit is handed out, once, to a participant', () => {
  const lines = [
    { id: 'q8', name: 'Quantainium', quantity: 5, qualityLevel: 800 },
    { id: 'q5', name: 'Quantainium', quantity: 3, qualityLevel: 500 },
    { id: 'g', name: 'Gold', quantity: 2, qualityLevel: 650 },
  ];
  const out = commodityRollAssignments(lines, people, seeded(1));
  assert.equal(out.length, 10);
  assert.equal(out.filter((u) => u.itemId === 'q8').length, 5);
  assert.equal(out.filter((u) => u.itemId === 'q5').length, 3);
  assert.equal(out.filter((u) => u.itemId === 'g').length, 2);
  const ids = new Set(people.map((p) => p.userId));
  for (const u of out) {
    assert.ok(ids.has(u.userId));
    assert.equal(u.username, people.find((p) => p.userId === u.userId).username);
  }
});

test('within a commodity the best QL goes first, in snake order', () => {
  const lines = [
    { id: 'low', name: 'Quantainium', quantity: 4, qualityLevel: 400 },
    { id: 'high', name: 'Quantainium', quantity: 4, qualityLevel: 900 },
  ];
  const out = commodityRollAssignments(lines, people, seeded(7));
  // The first four picks (one round) are the QL 900 units, one per person.
  assert.deepEqual(
    out.slice(0, 4).map((u) => u.itemId),
    ['high', 'high', 'high', 'high'],
  );
  assert.equal(new Set(out.slice(0, 4).map((u) => u.userId)).size, 4);
  // Round two runs the order backwards: last picker of round one picks first.
  assert.equal(out[4].userId, out[3].userId);
  assert.equal(out[7].userId, out[0].userId);
  assert.deepEqual(
    out.map((u) => u.pickNumber),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test('each commodity has its own order and units within one commodity stay even', () => {
  const lines = [
    { id: 'q', name: 'Quantainium', quantity: 10, qualityLevel: 800 },
    { id: 't', name: 'Taranite', quantity: 6, qualityLevel: 600 },
  ];
  for (let seed = 1; seed < 50; seed++) {
    const out = commodityRollAssignments(lines, people, seeded(seed));
    for (const id of ['q', 't']) {
      const counts = people.map((p) => out.filter((u) => u.itemId === id && u.userId === p.userId).length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `uneven ${id}: ${counts}`);
    }
  }
});

test('no participants, nothing handed out; zero quantity gives nothing', () => {
  assert.deepEqual(commodityRollAssignments([{ id: 'x', name: 'X', quantity: 3, qualityLevel: 1 }], []), []);
  assert.deepEqual(commodityRollAssignments([{ id: 'x', name: 'X', quantity: 0, qualityLevel: 1 }], people), []);
});

test("shares stack each member's units by name and QL, skipping gear", () => {
  const items = [
    {
      name: 'Quantainium',
      qualityLevel: 800,
      assignments: [
        { id: '1', userId: 'd', username: 'Destrokk', delivered: true },
        { id: '2', userId: 'd', username: 'Destrokk' },
        { id: '3', userId: 'm', username: 'Mango' },
      ],
    },
    { name: 'Quantainium', qualityLevel: 500, assignments: [{ id: '4', userId: 'd', username: 'Destrokk' }] },
    { name: 'P4-AR Rifle', qualityLevel: null, assignments: [{ id: '5', userId: 'd', username: 'Destrokk' }] },
  ];
  const shares = commodityShares(items);
  assert.equal(shares.length, 2);
  const d = shares.find((s) => s.userId === 'd');
  assert.deepEqual(
    d.lines.map((l) => [commodityShareLabel(l), l.delivered, l.assignmentIds]),
    [
      ['Quantainium QL 800 ×2', 1, ['1', '2']],
      ['Quantainium QL 500', 0, ['4']],
    ],
  );
});

test('chunkBlocks keeps blocks whole and under the limit', () => {
  const blocks = Array.from(
    { length: 30 },
    (_, i) => `**Member ${i}:**\n• ${'Quantainium QL 800 ×3\n• '.repeat(6)}end`,
  );
  const chunks = chunkBlocks(blocks, 1000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, `chunk ${c.length}`);
  assert.equal(chunks.join('\n\n'), blocks.join('\n\n'));
  const long = chunkBlocks(['x'.repeat(50)], 10);
  assert.equal(long[0].length, 10);
  assert.ok(long[0].endsWith('…'));
  assert.deepEqual(chunkBlocks([]), []);
});
