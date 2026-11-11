// Ally network rules. Run: `npm test -w @dem/shared`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortPair, inPair, otherGuild, autoAcceptField, receiverAutoAccepts, canShareEvents,
  decideRequest, decideResponse, decideCancel, decideAllyChange, decideUnblock,
  retryAfterFrom, allyRefusalMessage, ALLY_RETRY_DAYS,
  allyCodeFromBytes, normalizeAllyCode, formatAllyCode, ALLY_CODE_ALPHABET,
  pairsFromAlliances, responseChanges, isAllyNoticePayload, allyButtonId, parseAllyButtonId,
} from '../dist/allies.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const A = 'g-aaa', B = 'g-bbb', C = 'g-ccc';
const link = (over = {}) => ({
  guildAId: A, guildBId: B, status: 'PENDING', requestedByGuildId: A,
  retryAfter: null, blockedByGuildId: null, autoAcceptA: false, autoAcceptB: false, ...over,
});

test('pair is stored in one order, never with itself', () => {
  assert.deepEqual(sortPair(B, A), [A, B]);
  assert.deepEqual(sortPair(A, B), [A, B]);
  assert.throws(() => sortPair(A, A));
});

test('pair helpers', () => {
  const l = link();
  assert.equal(inPair(l, A), true);
  assert.equal(inPair(l, C), false);
  assert.equal(otherGuild(l, A), B);
  assert.equal(otherGuild(l, B), A);
  assert.throws(() => otherGuild(l, C));
  assert.equal(autoAcceptField(l, A), 'autoAcceptA');
  assert.equal(autoAcceptField(l, B), 'autoAcceptB');
  assert.throws(() => autoAcceptField(l, C));
});

test("auto-accept reads the RECEIVING org's own setting", () => {
  const l = link({ status: 'ACCEPTED', autoAcceptA: true, autoAcceptB: false });
  assert.equal(receiverAutoAccepts(l, A), true, 'A chose to auto-post B\'s events');
  assert.equal(receiverAutoAccepts(l, B), false, 'B still approves each of A\'s events');
});

test('only allies can share events', () => {
  assert.equal(canShareEvents(link({ status: 'ACCEPTED' })), true);
  for (const s of ['PENDING', 'REJECTED', 'BLOCKED']) assert.equal(canShareEvents(link({ status: s })), false, s);
  assert.equal(canShareEvents(null), false);
  assert.equal(canShareEvents(undefined), false);
});

test('request: new, self, already allies, already asked', () => {
  assert.deepEqual(decideRequest(null, A, B, NOW), { ok: true, action: 'create' });
  assert.equal(decideRequest(null, A, A, NOW).refusal, 'self');
  assert.equal(decideRequest(link({ status: 'ACCEPTED' }), A, B, NOW).refusal, 'already-allies');
  assert.equal(decideRequest(link({ status: 'ACCEPTED' }), B, A, NOW).refusal, 'already-allies');
  assert.equal(decideRequest(link({ requestedByGuildId: A }), A, B, NOW).refusal, 'already-requested');
});

test('request: crossing requests become allies', () => {
  assert.deepEqual(decideRequest(link({ requestedByGuildId: A }), B, A, NOW), { ok: true, action: 'accept' });
});

test('request: a block stops the blocked org, and the blocker must unblock first', () => {
  const blockedByB = link({ status: 'BLOCKED', blockedByGuildId: B, requestedByGuildId: A });
  assert.equal(decideRequest(blockedByB, A, B, NOW).refusal, 'blocked');
  assert.equal(decideRequest(blockedByB, B, A, NOW).refusal, 'you-blocked');
});

test('request: 7-day wait after a rejection applies only to the rejected org', () => {
  const rejectedAt = new Date('2026-11-08T12:00:00Z');
  const rejected = link({ status: 'REJECTED', requestedByGuildId: A, retryAfter: retryAfterFrom(rejectedAt) });
  const r = decideRequest(rejected, A, B, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.refusal, 'retry-later');
  assert.equal(r.retryAfter.toISOString(), '2026-11-15T12:00:00.000Z');
  // the org that rejected may ask the other way any time
  assert.deepEqual(decideRequest(rejected, B, A, NOW), { ok: true, action: 'reopen' });
  // after the wait, the rejected org may ask again
  assert.deepEqual(decideRequest(rejected, A, B, new Date('2026-11-15T12:00:00Z')), { ok: true, action: 'reopen' });
  assert.equal(decideRequest(rejected, A, B, new Date('2026-11-15T11:59:59Z')).refusal, 'retry-later');
  // a rejected row with no date (shouldn't happen) never locks anyone out
  assert.deepEqual(decideRequest(link({ status: 'REJECTED', retryAfter: null }), A, B, NOW), { ok: true, action: 'reopen' });
});

test('retry date is exactly ALLY_RETRY_DAYS later', () => {
  assert.equal(ALLY_RETRY_DAYS, 7);
  assert.equal(retryAfterFrom(NOW).getTime() - NOW.getTime(), 7 * 86_400_000);
});

test('respond: only the asked org, only while pending', () => {
  const l = link({ requestedByGuildId: A });
  assert.deepEqual(decideResponse(l, B), { ok: true });
  assert.equal(decideResponse(l, A).refusal, 'not-yours', 'cannot accept your own request');
  assert.equal(decideResponse(l, C).refusal, 'not-yours', 'outsiders cannot act');
  assert.equal(decideResponse(link({ status: 'ACCEPTED' }), B).refusal, 'not-pending');
  assert.equal(decideResponse(link({ status: 'REJECTED' }), B).refusal, 'not-pending');
});

test('cancel: only the sender, only while pending', () => {
  const l = link({ requestedByGuildId: A });
  assert.deepEqual(decideCancel(l, A), { ok: true });
  assert.equal(decideCancel(l, B).refusal, 'not-yours');
  assert.equal(decideCancel(l, C).refusal, 'not-yours');
  assert.equal(decideCancel(link({ status: 'ACCEPTED' }), A).refusal, 'not-pending');
});

test('remove or change an alliance: either side, only when allies', () => {
  const l = link({ status: 'ACCEPTED' });
  assert.deepEqual(decideAllyChange(l, A), { ok: true });
  assert.deepEqual(decideAllyChange(l, B), { ok: true });
  assert.equal(decideAllyChange(l, C).refusal, 'not-yours');
  assert.equal(decideAllyChange(link({ status: 'PENDING' }), A).refusal, 'not-allies');
});

test('unblock: only the org that blocked', () => {
  const l = link({ status: 'BLOCKED', blockedByGuildId: B });
  assert.deepEqual(decideUnblock(l, B), { ok: true });
  assert.equal(decideUnblock(l, A).refusal, 'not-yours');
  assert.equal(decideUnblock(l, C).refusal, 'not-yours');
  assert.equal(decideUnblock(link({ status: 'ACCEPTED' }), B).refusal, 'not-yours');
});

test('every refusal has a message; blocked wording does not reveal the block', () => {
  for (const r of ['self', 'already-allies', 'already-requested', 'blocked', 'you-blocked', 'retry-later', 'not-pending', 'not-yours', 'not-allies']) {
    assert.ok(allyRefusalMessage(r).length > 10, r);
  }
  assert.doesNotMatch(allyRefusalMessage('blocked'), /block/i);
  assert.match(allyRefusalMessage('retry-later', new Date('2026-11-15T12:00:00Z')), /2026-11-15/);
});

test('ally codes: 8 unambiguous characters, normalised from user input', () => {
  const code = allyCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255, 100, 200, 7]));
  assert.equal(code.length, 8);
  for (const ch of code) assert.ok(ALLY_CODE_ALPHABET.includes(ch));
  assert.equal(code[0], code[3], '0 and 32 map to the same letter (no modulo bias across 256)');
  assert.doesNotMatch(ALLY_CODE_ALPHABET, /[01OI]/);
  assert.throws(() => allyCodeFromBytes(new Uint8Array(4)));
  assert.equal(normalizeAllyCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(normalizeAllyCode('AB CD EF GH'), 'ABCDEFGH');
  assert.equal(normalizeAllyCode('ABCDEFG'), null, 'too short');
  assert.equal(normalizeAllyCode('ABCDEFGO'), null, 'O is not in the alphabet');
  assert.equal(normalizeAllyCode(''), null);
  assert.equal(normalizeAllyCode(undefined), null);
  assert.equal(formatAllyCode('ABCDEFGH'), 'ABCD-EFGH');
});

test('migration: 1-to-1 links and every two accepted members of a group become pairs', () => {
  const { pairs, droppedPending } = pairsFromAlliances([
    { id: '1', name: 'x', isDirect: true, members: [{ guildId: B, status: 'ACCEPTED' }, { guildId: A, status: 'ACCEPTED' }] },
    { id: '2', name: 'Big Alliance', isDirect: false, members: [
      { guildId: A, status: 'ACCEPTED' }, { guildId: B, status: 'ACCEPTED' }, { guildId: C, status: 'ACCEPTED' }, { guildId: 'g-ddd', status: 'PENDING' }] },
    { id: '3', name: 'y', isDirect: true, members: [{ guildId: C, status: 'ACCEPTED' }, { guildId: 'g-eee', status: 'PENDING' }] },
    { id: '4', name: 'Solo', isDirect: false, members: [{ guildId: A, status: 'ACCEPTED' }] },
  ]);
  const keys = pairs.map((p) => `${p.guildAId}+${p.guildBId}:${p.from.join(',')}`).sort();
  assert.deepEqual(keys, [
    'g-aaa+g-bbb:direct ally link,Big Alliance',
    'g-aaa+g-ccc:Big Alliance',
    'g-bbb+g-ccc:Big Alliance',
  ]);
  assert.deepEqual(droppedPending, [{ allianceName: 'Big Alliance', guildId: 'g-ddd' }, { allianceName: 'y', guildId: 'g-eee' }]);
  for (const p of pairs) assert.ok(p.guildAId < p.guildBId, 'stored order');
  assert.deepEqual(pairs.find((p) => p.guildBId === 'g-bbb').allianceIds, ['1', '2']);
});

test('migration: duplicate member rows do not make a pair with itself', () => {
  const { pairs } = pairsFromAlliances([{ id: '1', name: 'dup', isDirect: false, members: [
    { guildId: A, status: 'ACCEPTED' }, { guildId: A, status: 'ACCEPTED' }, { guildId: B, status: 'ACCEPTED' }] }]);
  assert.equal(pairs.length, 1);
});

test('answers change the same columns everywhere', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.deepEqual(responseChanges('accept', B, 'u1', now), { status: 'ACCEPTED', respondedAt: now, acceptedAt: now, respondedBy: 'u1', retryAfter: null });
  const rej = responseChanges('reject', B, 'u1', now);
  assert.equal(rej.status, 'REJECTED');
  assert.equal(rej.retryAfter.toISOString(), '2026-11-17T12:00:00.000Z');
  assert.deepEqual(responseChanges('block', B, null, now), { status: 'BLOCKED', respondedAt: now, respondedBy: null, blockedByGuildId: B, retryAfter: null });
});

test('notice payloads are validated before the bot acts on them', () => {
  const ok = { event: 'requested', linkId: 'l1', actorGuildId: A, otherGuildId: B, actorUserId: '123', noticeChannelId: null, noticeMessageId: null };
  assert.equal(isAllyNoticePayload(ok), true);
  assert.equal(isAllyNoticePayload({ ...ok, event: 'exploded' }), false);
  assert.equal(isAllyNoticePayload({ ...ok, linkId: 5 }), false);
  assert.equal(isAllyNoticePayload({ ...ok, actorUserId: undefined }), false);
  assert.equal(isAllyNoticePayload(null), false);
  assert.equal(isAllyNoticePayload('requested'), false);
});

test('button ids round-trip and reject anything else', () => {
  assert.equal(allyButtonId('block', 'cmabc123'), 'ally:block:cmabc123');
  assert.deepEqual(parseAllyButtonId('ally:accept:cmabc123'), { action: 'accept', linkId: 'cmabc123' });
  assert.equal(parseAllyButtonId('ally:delete:cmabc123'), null);
  assert.equal(parseAllyButtonId('ally:accept:'), null);
  assert.equal(parseAllyButtonId('ally:accept:a:b'), null);
  assert.equal(parseAllyButtonId('loot:accept:x'), null);
});

// ── Sharing events with allies (v1.11.0) ────────────────────────────────────
import {
  planShares, withdrawnOnRemoval, isShareNoticePayload, shareButtonId, parseShareButtonId, NOT_ALLY_MESSAGE,
} from '../dist/allies.js';

const D = 'g-ddd';

test('planShares: only allies get the event; each ally\'s own setting decides', () => {
  const links = [
    link({ status: 'ACCEPTED', autoAcceptB: true }),                       // A–B: B posts A's events automatically
    link({ guildBId: C, status: 'ACCEPTED' }),                             // A–C: C approves each
    link({ guildBId: D, status: 'PENDING' }),                              // A–D: not allies yet
  ];
  assert.deepEqual(planShares(A, [B, C, D, 'g-zzz'], links), { accepted: [B], pending: [C], notAllies: [D, 'g-zzz'] });
});

test('planShares: the receiving side\'s flag counts, not the host\'s', () => {
  const l = link({ status: 'ACCEPTED', autoAcceptA: true }); // A posts B's events automatically
  assert.deepEqual(planShares(A, [B], [l]), { accepted: [], pending: [B], notAllies: [] });
  assert.deepEqual(planShares(B, [A], [l]), { accepted: [A], pending: [], notAllies: [] });
});

test('planShares: rejected and blocked pairs are not allies; duplicates and the host are ignored', () => {
  assert.deepEqual(planShares(A, [B], [link({ status: 'REJECTED' })]).notAllies, [B]);
  assert.deepEqual(planShares(A, [B], [link({ status: 'BLOCKED', blockedByGuildId: B })]).notAllies, [B]);
  assert.deepEqual(planShares(A, [B, B, A], [link({ status: 'ACCEPTED' })]), { accepted: [], pending: [B], notAllies: [] });
  assert.deepEqual(planShares(A, [], []), { accepted: [], pending: [], notAllies: [] });
});

test('planShares: a link between two other orgs doesn\'t count', () => {
  const bc = { ...link({ status: 'ACCEPTED' }), guildAId: B, guildBId: C };
  assert.deepEqual(planShares(A, [C], [bc]).notAllies, [C]);
});

test('withdrawnOnRemoval: only waiting invitations between the two orgs, both ways', () => {
  const pair = { guildAId: A, guildBId: B };
  assert.equal(withdrawnOnRemoval({ status: 'PENDING', hostGuildId: A, guildId: B }, pair), true);
  assert.equal(withdrawnOnRemoval({ status: 'PENDING', hostGuildId: B, guildId: A }, pair), true);
  assert.equal(withdrawnOnRemoval({ status: 'ACCEPTED', hostGuildId: A, guildId: B }, pair), false);
  assert.equal(withdrawnOnRemoval({ status: 'DECLINED', hostGuildId: A, guildId: B }, pair), false);
  assert.equal(withdrawnOnRemoval({ status: 'PENDING', hostGuildId: A, guildId: C }, pair), false);
  assert.equal(withdrawnOnRemoval({ status: 'PENDING', hostGuildId: C, guildId: B }, pair), false);
});

test('share notice payloads and button ids', () => {
  const p = { event: 'pending', shareId: 's1', eventId: 'e1', hostGuildId: A, receiverGuildId: B, actorUserId: null, noticeChannelId: null, noticeMessageId: null };
  assert.equal(isShareNoticePayload(p), true);
  for (const e of ['accepted', 'declined', 'withdrawn']) assert.equal(isShareNoticePayload({ ...p, event: e, actorUserId: 'u1', noticeChannelId: 'c', noticeMessageId: 'm' }), true);
  assert.equal(isShareNoticePayload({ ...p, event: 'removed' }), false);
  assert.equal(isShareNoticePayload({ ...p, eventId: undefined }), false);
  assert.equal(isShareNoticePayload({ ...p, actorUserId: 5 }), false);
  assert.equal(isShareNoticePayload(null), false);
  assert.equal(shareButtonId('accept', 's1'), 'share:accept:s1');
  assert.deepEqual(parseShareButtonId('share:decline:cmabc123'), { action: 'decline', shareId: 'cmabc123' });
  assert.equal(parseShareButtonId('share:block:s1'), null);
  assert.equal(parseShareButtonId('ally:accept:s1'), null);
  assert.equal(parseShareButtonId('share:accept:'), null);
  assert.match(NOT_ALLY_MESSAGE, /allies/);
});
