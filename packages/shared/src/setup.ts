// The setup checklist for a server's officers (v1.15.0): what's still missing
// for ASOP to work there, including Discord permissions the bot lacks in the
// channels it was given. The admin panel lists the same problems.

// ── Discord permissions ──────────────────────────────────────────────────────

export const PERMS = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_EVENTS: 1n << 33n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  CREATE_EVENTS: 1n << 44n,
} as const;
const ALL = (1n << 64n) - 1n;

export interface DiscordOverwrite { id: string; type: number; allow: string; deny: string }
export interface DiscordChannelInfo { id: string; name: string; type: number; parent_id?: string | null; permission_overwrites?: DiscordOverwrite[] }
export interface DiscordRoleInfo { id: string; permissions: string }

/** A member's server-wide permissions: @everyone plus their roles. */
export function basePermissions(guildId: string, roles: readonly DiscordRoleInfo[], memberRoleIds: readonly string[]): bigint {
  let perms = 0n;
  for (const r of roles) if (r.id === guildId || memberRoleIds.includes(r.id)) perms |= BigInt(r.permissions);
  return perms & PERMS.ADMINISTRATOR ? ALL : perms;
}

/** A member's permissions in a channel, after its overwrites (Discord's own order). */
export function channelPermissions(base: bigint, guildId: string, memberId: string, memberRoleIds: readonly string[], overwrites: readonly DiscordOverwrite[] = []): bigint {
  if (base & PERMS.ADMINISTRATOR) return ALL;
  let perms = base;
  const everyone = overwrites.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n, deny = 0n;
  for (const o of overwrites) if (o.type === 0 && memberRoleIds.includes(o.id)) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
  perms = (perms & ~deny) | allow;
  const mine = overwrites.find((o) => o.type === 1 && o.id === memberId);
  if (mine) perms = (perms & ~BigInt(mine.deny)) | BigInt(mine.allow);
  return perms;
}

type Need = [bigint, string][];
const FORUM_NEEDS: Need = [[PERMS.VIEW_CHANNEL, 'View Channel'], [PERMS.SEND_MESSAGES, 'Create Posts'], [PERMS.SEND_MESSAGES_IN_THREADS, 'Send Messages in Posts'],
  [PERMS.EMBED_LINKS, 'Embed Links'], [PERMS.ATTACH_FILES, 'Attach Files'], [PERMS.READ_MESSAGE_HISTORY, 'Read Message History']];
const CATEGORY_NEEDS: Need = [[PERMS.VIEW_CHANNEL, 'View Channel'], [PERMS.MANAGE_CHANNELS, 'Manage Channels']];
const TEXT_NEEDS: Need = [[PERMS.VIEW_CHANNEL, 'View Channel'], [PERMS.SEND_MESSAGES, 'Send Messages'], [PERMS.EMBED_LINKS, 'Embed Links']];

// ── The checklist ────────────────────────────────────────────────────────────

/** Where on the website a step is fixed (a settings page, or creating an event). */
export type SetupPage = 'event-bot' | 'loot' | 'dkp' | 'tournaments' | 'bot' | 'allies' | 'jobs' | 'new-event';

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** Nice to have; doesn't count as unfinished */
  optional?: boolean;
  /** Something chosen that doesn't work (deleted, or the bot lacks permissions), rather than not chosen yet */
  broken?: boolean;
  /** What's set ("#operations"), or what's wrong ("The bot is missing Create Posts.") */
  detail?: string;
  page: SetupPage;
}

export interface SetupChecklistDto {
  steps: SetupStep[];
  /** Officers hid the card on the server page; the settings page still shows it */
  hidden: boolean;
  /** Discord couldn't be asked, so channels and permissions weren't checked */
  discordChecked: boolean;
}

/** What the checklist needs from Discord: the server's channels and roles, and the bot's roles. */
export interface SetupDiscord {
  guildId: string;
  botId: string;
  botRoleIds: string[];
  channels: DiscordChannelInfo[];
  roles: DiscordRoleInfo[];
}

export interface SetupInput {
  /** The GuildSettings row (null when never saved) */
  settings: Record<string, unknown> | null;
  hasEvents: boolean;
  discord: SetupDiscord | null;
}

/** Required, unfinished steps in plain words: the admin panel's "looks unfinished" list. */
export function setupProblems(steps: readonly SetupStep[]): string[] {
  return steps.filter((s) => !s.done && !s.optional).map((s) => (s.detail ? `${s.label}: ${s.detail}` : s.label));
}

export function setupChecklist({ settings: s, hasEvents, discord }: SetupInput): SetupStep[] {
  const on = (k: string) => !s || s[k] !== false;
  const str = (k: string) => (s && typeof s[k] === 'string' && s[k] ? (s[k] as string) : null);
  const base = discord ? basePermissions(discord.guildId, discord.roles, discord.botRoleIds) : 0n;
  const steps: SetupStep[] = [];

  /** A channel setting: chosen, still there, and usable by the bot. */
  const channel = (key: string, label: string, setting: string, page: SetupPage, needs: Need, kind: string, why: string) => {
    const id = str(setting);
    if (!id) return steps.push({ key, label, done: false, detail: why, page });
    if (!discord) return steps.push({ key, label, done: true, page });
    const ch = discord.channels.find((c) => c.id === id);
    if (!ch) return steps.push({ key, label, done: false, detail: `The chosen ${kind} was deleted. Pick another.`, page, broken: true });
    const name = ch.type === 4 ? ch.name : `#${ch.name}`;
    // A channel in a category takes the category's overwrites only when it's synced; Discord stores them on the channel either way.
    const have = channelPermissions(base, discord.guildId, discord.botId, discord.botRoleIds, ch.permission_overwrites);
    const missing = needs.filter(([bit]) => !(have & bit)).map(([, n]) => n);
    return steps.push(missing.length
      ? { key, label, done: false, detail: `The bot is missing ${missing.join(', ')} in ${name}.`, page, broken: true }
      : { key, label, done: true, detail: name, page });
  };

  const tz = str('timezone');
  steps.push({ key: 'timezone', label: 'Set your time zone', done: !!tz && tz !== 'UTC', detail: tz && tz !== 'UTC' ? tz : 'Event times are shown in UTC until you do.', page: 'event-bot' });

  if (on('eventBotEnabled')) {
    channel('forum', 'Choose an event forum', 'forumChannelId', 'event-bot', FORUM_NEEDS, 'forum', 'Events aren\'t posted in Discord without it.');
    channel('voice', 'Choose a voice channel category', 'voiceCategoryId', 'event-bot', CATEGORY_NEEDS, 'category', 'Events get no voice channels without it.');
    if (discord && !(base & (PERMS.MANAGE_EVENTS | PERMS.CREATE_EVENTS))) {
      steps.push({ key: 'events-perm', label: 'Let the bot create Discord events', done: false, detail: 'The bot is missing Manage Events, so events don\'t show in Discord\'s Events list.', page: 'event-bot', broken: true });
    }
    const creators = (() => { try { return (JSON.parse(String(s?.['eventCreatorRoles'] ?? '[]')) as unknown[]).length; } catch { return 0; } })();
    steps.push({ key: 'creators', label: 'Choose who can create events', done: creators > 0, optional: true, detail: creators ? `${creators} role${creators === 1 ? '' : 's'}` : 'Only server managers can, for now.', page: 'event-bot' });
  }
  if (on('lootEnabled')) channel('loot', 'Choose a loot results channel', 'lootChannelId', 'loot', TEXT_NEEDS, 'channel', 'Loot results aren\'t posted without it.');
  if (on('dkpEnabled')) channel('dkp', 'Choose an auction announcements channel', 'dkpAnnouncementChannelId', 'dkp', TEXT_NEEDS, 'channel', 'Auctions aren\'t announced without it.');
  if (on('tournamentsEnabled')) channel('tournaments', 'Choose a tournament forum', 'tournamentChannelId', 'tournaments', FORUM_NEEDS, 'forum', 'Tournaments aren\'t posted without it.');

  // Optional channels: only checked once chosen.
  if (discord) {
    for (const [setting, key, label, page] of [
      ['statusChannelId', 'status', 'ASOP status channel', 'bot'],
      ['allyNoticeChannelId', 'allies', 'Ally notices channel', 'allies'],
      ['h2hChannelId', 'h2h', 'Head-to-head results channel', 'tournaments'],
      ['jobsChannelId', 'jobs', 'Job board channel', 'jobs'],
    ] as const) {
      if (!str(setting)) continue;
      const before = steps.length;
      channel(key, label, setting, page, TEXT_NEEDS, 'channel', '');
      if (steps[before]!.done) steps.pop(); // fine: nothing to show
    }
  }

  if (on('eventBotEnabled')) steps.push({ key: 'first-event', label: 'Create your first event', done: hasEvents, optional: true, page: 'new-event' });
  return steps;
}
