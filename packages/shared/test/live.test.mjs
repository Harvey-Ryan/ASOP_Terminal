import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMiddleware, createLiveQueue, isLiveTopic, liveTopicGuild, parseLiveNotice } from '../dist/index.js';

function harness(tables = {}) {
  const sent = [];
  const reads = [];
  const deps = {
    findKeys: async (model, where, keys) => {
      reads.push(model);
      const ids = where?.id?.in;
      return (tables[model] ?? []).filter((r) => (ids ? ids.includes(r.id) : Object.entries(where).every(([k, v]) => r[k] === v)))
        .map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
    },
    lookups: {
      itemSession: async (id) => ({ i1: 's1' })[id] ?? null,
      lootAuctionSession: async (id) => ({ la1: 's2' })[id] ?? null,
      auctionGuild: async (id) => ({ a1: 'g9' })[id] ?? null,
    },
    queue: { add: (topics, tx) => sent.push({ topics: topics.sort(), tx }) },
    onError: (err) => { throw err; },
  };
  return { mw: liveMiddleware(deps), sent, reads };
}

test('writes to watched models become topics; reads and other models don\'t', async () => {
  const { mw, sent } = harness();
  await mw({ model: 'LootSession', action: 'update', args: {} }, async () => ({ id: 's1', guildId: 'g1', eventId: 'e1' }));
  await mw({ model: 'LootAssignment', action: 'create', args: {} }, async () => ({ id: 'x', itemId: 'i1' }));
  await mw({ model: 'LootAuctionBid', action: 'create', args: {}, runInTransaction: true }, async () => ({ id: 'b', auctionId: 'la1' }));
  await mw({ model: 'AuctionBid', action: 'create', args: {} }, async () => ({ id: 'b', auctionId: 'a1' }));
  await mw({ model: 'TradeMessage', action: 'createMany', args: { data: [{ tradeId: 't1' }, { tradeId: 't1' }] } }, async () => ({ count: 2 }));
  await mw({ model: 'LootSession', action: 'findMany', args: {} }, async () => []);
  await mw({ model: 'Event', action: 'update', args: {} }, async () => ({ id: 'e1' }));
  assert.deepEqual(sent, [
    { topics: ['loot-event:e1', 'loot-guild:g1', 'loot:s1'], tx: false },
    { topics: ['loot:s1'], tx: false },
    { topics: ['loot:s2'], tx: true },
    { topics: ['auctions:g9'], tx: false },
    { topics: ['trade:t1'], tx: false },
  ]);
});

test('updateMany and deleteMany read the keys before writing; a select reads them after', async () => {
  const { mw, sent, reads } = harness({ LootItem: [{ id: 'i1', sessionId: 's1' }, { id: 'i2', sessionId: 's2' }] });
  await mw({ model: 'LootItem', action: 'deleteMany', args: { where: { id: { in: ['i1', 'i2'] } } } }, async () => ({ count: 2 }));
  await mw({ model: 'LootItem', action: 'update', args: { select: { id: true } } }, async () => ({ id: 'i2' }));
  assert.deepEqual(sent.map((s) => s.topics), [['loot:s1', 'loot:s2'], ['loot:s2']]);
  assert.deepEqual(reads, ['LootItem', 'LootItem']);
});

test('a failed write sends nothing and still fails', async () => {
  const { mw, sent } = harness();
  await assert.rejects(mw({ model: 'Trade', action: 'update', args: {} }, async () => { throw new Error('nope'); }), /nope/);
  assert.deepEqual(sent, []);
});

test('the queue batches a burst and repeats transaction topics later', async () => {
  const out = [];
  const q = createLiveQueue(async (t) => { out.push(t.sort()); }, { delayMs: 10, txFollowUpMs: 40 });
  q.add(['loot:a'], false);
  q.add(['loot:b', 'loot:a'], true);
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(out, [['loot:a', 'loot:b']]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(out, [['loot:a', 'loot:b'], ['loot:b', 'loot:a'].sort()]);
});

test('topics a browser may ask for', () => {
  assert.equal(isLiveTopic('loot:clx1abc'), true);
  assert.equal(isLiveTopic('auctions:123456789012345678'), true);
  assert.equal(isLiveTopic('events:123'), false);
  assert.equal(isLiveTopic('loot:a b'), false);
  assert.equal(liveTopicGuild('auctions:42'), '42');
  assert.equal(liveTopicGuild('loot-guild:42'), '42');
  assert.equal(liveTopicGuild('loot:42'), null);
  assert.deepEqual(parseLiveNotice('{"t":["loot:a",3]}'), ['loot:a']);
  assert.deepEqual(parseLiveNotice('nonsense'), []);
});
