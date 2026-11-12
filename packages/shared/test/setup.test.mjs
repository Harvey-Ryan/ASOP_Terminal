import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMS, BOT_PERMISSIONS, BOT_INVITE_PERMISSIONS, botInviteUrl, basePermissions, channelPermissions, setupChecklist, setupProblems } from '../dist/index.js';

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
  assert.deepEqual(steps.map((s) => s.key), ['forum', 'voice', 'creators', 'dkp', 'tournaments', 'first-event']);
  assert.ok(steps.every((s) => !s.done));
  assert.deepEqual(setupProblems(steps).slice(0, 1), ['Choose an event forum: Events aren\'t posted in Discord without it.']);
  assert.ok(!steps.some((s) => s.key === 'timezone')); // everyone sees their own time zone (v1.21.2)
  assert.ok(!steps.some((s) => s.key === 'loot')); // optional: event loot posts in the event's thread (v1.22.0)
  assert.ok(!setupProblems(steps).some((t) => t.includes('first event') || t.includes('who can create')));
});

test('a set-up server: names shown, permission gaps and deleted channels caught', () => {
  const settings = { ...allOff, timezone: 'America/Chicago', forumChannelId: 'forum', voiceCategoryId: 'cat', lootChannelId: 'loot', eventCreatorRoles: '["a"]' };
  const s = byKey(setupChecklist({ settings, hasEvents: true, discord: discord() }));
  assert.deepEqual([s.forum.detail, s.voice.detail, s.creators.detail], ['#operations', 'Ops voice', '1 role']);
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
  assert.deepEqual(steps.map((s) => s.key), []);
  const s = byKey(setupChecklist({ settings: { ...allOff, lootEnabled: false, forumChannelId: 'x', voiceCategoryId: 'y' }, hasEvents: false, discord: null }));
  assert.equal(s.forum.done && s.voice.done, true);
});

test('the invite asks for exactly what the bot uses, never Administrator', () => {
  assert.equal(BOT_INVITE_PERMISSIONS & PERMS.ADMINISTRATOR, 0n);
  for (const [bit] of BOT_PERMISSIONS) assert.ok(BOT_INVITE_PERMISSIONS & bit);
  // Everything the checklist checks for is in the invite.
  for (const bit of [PERMS.VIEW_CHANNEL, PERMS.SEND_MESSAGES, PERMS.SEND_MESSAGES_IN_THREADS, PERMS.EMBED_LINKS, PERMS.ATTACH_FILES, PERMS.READ_MESSAGE_HISTORY, PERMS.MANAGE_CHANNELS, PERMS.MANAGE_EVENTS, PERMS.MANAGE_ROLES]) {
    assert.ok(BOT_INVITE_PERMISSIONS & bit);
  }
  assert.match(botInviteUrl('42'), /client_id=42&permissions=\d+&scope=bot\+applications\.commands$/);
});

test('missing or deleted channels can be created with one click; broken permissions can\'t', () => {
  const fresh = byKey(setupChecklist({ settings: null, hasEvents: false, discord: null }));
  assert.deepEqual([fresh.forum.create, fresh.voice.create, fresh.dkp.create, fresh.tournaments.create], ['forum', 'voice', 'dkp', 'tournaments']);
  assert.equal(fresh.creators.create, undefined);
  const settings = { ...allOff, forumChannelId: 'deleted', voiceCategoryId: 'cat' };
  const s = byKey(setupChecklist({ settings, hasEvents: true, discord: discord() }));
  assert.equal(s.forum.create, 'forum'); // deleted: make a new one
  assert.equal(s.voice.create, undefined); // fine as it is
  const noPerm = discord({ roles: [{ id: G, permissions: '0' }, { id: BOT_ROLE, permissions: p(PERMS.VIEW_CHANNEL) }] });
  const t = byKey(setupChecklist({ settings: { ...allOff, forumChannelId: 'forum' }, hasEvents: true, discord: noPerm }));
  assert.equal(t.forum.broken, true);
  assert.equal(t.forum.create, undefined); // the fix is a permission, not a new channel
});

test('without Manage Roles the loot draft can\'t mark the picker: a step says so', () => {
  const settings = { ...allOff, forumChannelId: 'forum', voiceCategoryId: 'cat' };
  const without = byKey(setupChecklist({ settings, hasEvents: true, discord: discord() }));
  assert.equal(without['roles-perm'].broken, true);
  const withRoles = discord({ roles: [{ id: G, permissions: '0' }, { id: BOT_ROLE, permissions: p(...FORUM, PERMS.MANAGE_CHANNELS, PERMS.MANAGE_EVENTS, PERMS.MANAGE_ROLES) }] });
  assert.equal(byKey(setupChecklist({ settings, hasEvents: true, discord: withRoles }))['roles-perm'], undefined);
  assert.equal(byKey(setupChecklist({ settings: { ...settings, lootEnabled: false }, hasEvents: true, discord: discord() }))['roles-perm'], undefined);
});
