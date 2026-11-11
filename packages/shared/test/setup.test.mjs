import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMS, basePermissions, channelPermissions, setupChecklist, setupProblems } from '../dist/index.js';

const G = 'g1', BOT = 'bot', BOT_ROLE = 'r-bot';
const p = (...bits) => String(bits.reduce((a, b) => a | b, 0n));
const TEXT = [PERMS.VIEW_CHANNEL, PERMS.SEND_MESSAGES, PERMS.EMBED_LINKS];
const FORUM = [...TEXT, PERMS.SEND_MESSAGES_IN_THREADS, PERMS.ATTACH_FILES, PERMS.READ_MESSAGE_HISTORY];

test('permissions: roles add up; administrator gets everything', () => {
  const roles = [{ id: G, permissions: p(PERMS.VIEW_CHANNEL) }, { id: BOT_ROLE, permissions: p(PERMS.SEND_MESSAGES) }, { id: 'admin', permissions: p(PERMS.ADMINISTRATOR) }];
  assert.equal(basePermissions(G, roles, [BOT_ROLE]), PERMS.VIEW_CHANNEL | PERMS.SEND_MESSAGES);
  assert.ok(basePermissions(G, roles, ['admin']) & PERMS.MANAGE_EVENTS);
});

test('permissions: overwrites in Discord order (everyone, roles, member)', () => {
  const base = PERMS.VIEW_CHANNEL | PERMS.SEND_MESSAGES;
  const ow = (id, type, allow, deny) => ({ id, type, allow: String(allow), deny: String(deny) });
  // @everyone denied, the bot's role allowed back
  assert.equal(channelPermissions(base, G, BOT, [BOT_ROLE], [ow(G, 0, 0n, PERMS.SEND_MESSAGES), ow(BOT_ROLE, 0, PERMS.SEND_MESSAGES, 0n)]) & PERMS.SEND_MESSAGES, PERMS.SEND_MESSAGES);
  // a role allow beats another role's deny
  assert.ok(channelPermissions(base, G, BOT, [BOT_ROLE, 'x'], [ow('x', 0, 0n, PERMS.VIEW_CHANNEL), ow(BOT_ROLE, 0, PERMS.VIEW_CHANNEL, 0n)]) & PERMS.VIEW_CHANNEL);
  // the member's own deny wins over everything
  assert.equal(channelPermissions(base, G, BOT, [BOT_ROLE], [ow(BOT_ROLE, 0, PERMS.VIEW_CHANNEL, 0n), ow(BOT, 1, 0n, PERMS.VIEW_CHANNEL)]) & PERMS.VIEW_CHANNEL, 0n);
  // other roles' overwrites don't apply
  assert.ok(channelPermissions(base, G, BOT, [BOT_ROLE], [ow('other', 0, 0n, PERMS.VIEW_CHANNEL)]) & PERMS.VIEW_CHANNEL);
});

const discord = (over = {}) => ({
  guildId: G, botId: BOT, botRoleIds: [BOT_ROLE],
  roles: [{ id: G, permissions: '0' }, { id: BOT_ROLE, permissions: p(...FORUM, PERMS.MANAGE_CHANNELS, PERMS.MANAGE_EVENTS) }],
  channels: [
    { id: 'forum', name: 'operations', type: 15, permission_overwrites: [] },
    { id: 'cat', name: 'Ops voice', type: 4, permission_overwrites: [] },
    { id: 'loot', name: 'loot', type: 0, permission_overwrites: [{ id: BOT_ROLE, type: 0, allow: '0', deny: p(PERMS.EMBED_LINKS) }] },
  ],
  ...over,
});
const allOff = { dkpEnabled: false, tournamentsEnabled: false };
const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));

test('a fresh server: everything to do, in plain words', () => {
  const steps = setupChecklist({ settings: null, hasEvents: false, discord: null });
  assert.deepEqual(steps.map((s) => s.key), ['timezone', 'forum', 'voice', 'creators', 'loot', 'dkp', 'tournaments', 'first-event']);
  assert.ok(steps.every((s) => !s.done));
  assert.deepEqual(setupProblems(steps).slice(0, 2), ['Set your time zone: Event times are shown in UTC until you do.', 'Choose an event forum: Events aren\'t posted in Discord without it.']);
  assert.ok(!setupProblems(steps).some((t) => t.includes('first event') || t.includes('who can create')));
});

test('a set-up server: names shown, permission gaps and deleted channels caught', () => {
  const settings = { ...allOff, timezone: 'America/Chicago', forumChannelId: 'forum', voiceCategoryId: 'cat', lootChannelId: 'loot', eventCreatorRoles: '["a"]' };
  const s = byKey(setupChecklist({ settings, hasEvents: true, discord: discord() }));
  assert.deepEqual([s.timezone.done, s.forum.detail, s.voice.detail, s.creators.detail], [true, '#operations', 'Ops voice', '1 role']);
  assert.equal(s.loot.done, false);
  assert.equal(s.loot.detail, 'The bot is missing Embed Links in #loot.');
  assert.equal(s['events-perm'], undefined);
  const gone = byKey(setupChecklist({ settings: { ...settings, forumChannelId: 'deleted' }, hasEvents: true, discord: discord() }));
  assert.match(gone.forum.detail, /deleted/);
});

test('missing Manage Events and broken optional channels show up; working optional channels don\'t', () => {
  const d = discord({ roles: [{ id: G, permissions: '0' }, { id: BOT_ROLE, permissions: p(...FORUM) }] });
  d.channels.push({ id: 'status', name: 'status', type: 0, permission_overwrites: [] }, { id: 'allies', name: 'allies', type: 0, permission_overwrites: [{ id: G, type: 0, allow: '0', deny: p(PERMS.VIEW_CHANNEL) }] });
  const s = byKey(setupChecklist({ settings: { ...allOff, lootEnabled: false, statusChannelId: 'status', allyNoticeChannelId: 'allies' }, hasEvents: false, discord: d }));
  assert.equal(s['events-perm'].done, false);
  assert.equal(s.status, undefined);
  assert.match(s.allies.detail, /missing View Channel/);
});

test('switched-off modules add no steps; without Discord, chosen channels count as done', () => {
  const steps = setupChecklist({ settings: { eventBotEnabled: false, lootEnabled: false, dkpEnabled: false, tournamentsEnabled: false, timezone: 'UTC' }, hasEvents: false, discord: null });
  assert.deepEqual(steps.map((s) => s.key), ['timezone']);
  const s = byKey(setupChecklist({ settings: { ...allOff, lootEnabled: false, forumChannelId: 'x', voiceCategoryId: 'y' }, hasEvents: false, discord: null }));
  assert.equal(s.forum.done && s.voice.done, true);
});
