// Admin panel shapes (v1.13.0): /api/admin/* and the /dashboard/admin pages.

import type { ErrorLevel, ErrorSource } from './errorLog.js';

// ── Overview ────────────────────────────────────────────────────────────────

export interface AdminServiceDto {
  service: 'api' | 'bot';
  /** Beat in the last 3 minutes */
  up: boolean;
  startedAt: string | null;
  beatAt: string | null;
  release: string;
  details: Record<string, unknown>;
}

export interface AdminOverviewDto {
  release: { version: string; commit: string };
  services: AdminServiceDto[];
  database: { ok: boolean; latencyMs: number };
  gameData: { build: string | null; syncedAt: string | null; checkedAt: string | null } | null;
  servers: { total: number; joined7d: number; left7d: number };
  errors: { lastHour: number; last24h: number; warnings24h: number; bySource24h: Partial<Record<ErrorSource, number>>; newKinds24h: number; openKinds: number };
  /** null while request logging is switched off (REQUEST_LOG, v1.21.1) */
  requests: { last24h: number; failed24h: number; slowest24hMs: number } | null;
  activity: { upcomingEvents: number; liveEvents: number; openLootSessions: number; activeUsers7d: number };
  /** Errors per hour for the last 24 hours, oldest first */
  errorsByHour: { hour: string; errors: number; warnings: number }[];
  feed: { configured: boolean; alertsEnabled: boolean; digestEnabled: boolean };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export interface ErrorEventDto {
  id: number;
  createdAt: string;
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  /** Only in the detail view */
  stack?: string | null;
  fingerprint: string;
  ref: string | null;
  guildId: string | null;
  guildName: string | null;
  userId: string | null;
  userName: string | null;
  context: Record<string, unknown>;
  release: string;
  suppressed: number;
}

export type ErrorGroupStatus = 'open' | 'resolved' | 'ignored';

export interface ErrorGroupDto {
  fingerprint: string;
  source: ErrorSource;
  level: ErrorLevel;
  /** The latest occurrence's message */
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  servers: number;
  users: number;
  releases: string[];
  status: ErrorGroupStatus;
  note: string;
  /** Seen for the first time in the selected period */
  isNew: boolean;
}

export interface ErrorDetailDto {
  event: ErrorEventDto;
  group: ErrorGroupDto | null;
  /** Other errors from the same request / interaction (same ref) */
  sameRef: ErrorEventDto[];
  /** The latest occurrences of the same kind */
  recent: ErrorEventDto[];
}

export const ERROR_SOURCES: readonly ErrorSource[] = ['api', 'bot', 'web', 'sc-data'];

/** What the browser sends to POST /api/client-errors. */
export interface ClientErrorReport {
  message: string;
  stack?: string | null;
  /** window error | unhandled rejection | render crash | page load */
  kind: string;
  url: string;
  /** The API's ref when the error came with one */
  ref?: string | null;
  guildId?: string | null;
  /** The website build that sent it (an old tab after a release shows an older one) */
  version?: string | null;
}

// ── Servers ─────────────────────────────────────────────────────────────────

export interface AdminGuildDto {
  guildId: string;
  name: string;
  iconUrl: string | null;
  /** When the bot joined (first seen) */
  joinedAt: string;
  modules: Record<string, boolean>;
  /** Things that look unfinished, in plain words ("No forum channel: events won't be posted") */
  setupIssues: string[];
  counts: { upcomingEvents: number; events30d: number; members: number; allies: number };
  errors7d: number;
  lastEventAt: string | null;
}

export interface AdminGuildDetailDto extends AdminGuildDto {
  settings: Record<string, unknown>;
  /** From Discord, when it answers */
  discord: { memberCount: number | null; ownerId: string | null; channels: AdminChannelDto[]; roles: AdminRoleDto[] } | null;
  recentErrors: ErrorEventDto[];
  log: AdminLogDto[];
}

export interface AdminChannelDto { id: string; name: string; type: number; parentId: string | null }
export interface AdminRoleDto { id: string; name: string; color: number }

/** A setting the admin panel can edit; the field list drives the form and the audit log labels. */
export interface AdminSettingField {
  key: string;
  label: string;
  group: 'Modules' | 'Channels' | 'General' | 'Roles';
  type: 'boolean' | 'channel' | 'category' | 'forum' | 'text' | 'int' | 'timezone' | 'enum' | 'roles';
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
}

export const ADMIN_SETTING_FIELDS: readonly AdminSettingField[] = [
  { key: 'eventBotEnabled', label: 'Event Bot', group: 'Modules', type: 'boolean' },
  { key: 'dkpEnabled', label: 'DKP & Auctions', group: 'Modules', type: 'boolean' },
  { key: 'lootEnabled', label: 'Loot', group: 'Modules', type: 'boolean' },
  { key: 'exchangeEnabled', label: 'Marketplace', group: 'Modules', type: 'boolean' },
  { key: 'fleetEnabled', label: 'Fleet', group: 'Modules', type: 'boolean' },
  { key: 'blueprintsEnabled', label: 'Blueprints', group: 'Modules', type: 'boolean' },
  { key: 'craftingEnabled', label: 'Crafting Calculator', group: 'Modules', type: 'boolean' },
  { key: 'wikeloEnabled', label: 'Wikelo', group: 'Modules', type: 'boolean' },
  { key: 'activityEnabled', label: 'Activity', group: 'Modules', type: 'boolean' },
  { key: 'tournamentsEnabled', label: 'Tournaments', group: 'Modules', type: 'boolean' },
  { key: 'jobsEnabled', label: 'Job Board', group: 'Modules', type: 'boolean' },

  { key: 'forumChannelId', label: 'Event forum', group: 'Channels', type: 'forum', help: 'Where event threads are posted. Without it, events aren\'t posted in Discord.' },
  { key: 'eventChannelId', label: 'Scheduled events channel', group: 'Channels', type: 'channel' },
  { key: 'voiceCategoryId', label: 'Voice channel category', group: 'Channels', type: 'category', help: 'Where event voice channels are created.' },
  { key: 'lootChannelId', label: 'Loot results', group: 'Channels', type: 'channel' },
  { key: 'dkpAnnouncementChannelId', label: 'Auction announcements', group: 'Channels', type: 'channel' },
  { key: 'tournamentChannelId', label: 'Tournament forum', group: 'Channels', type: 'forum' },
  { key: 'h2hChannelId', label: 'Head-to-head results', group: 'Channels', type: 'channel' },
  { key: 'allyNoticeChannelId', label: 'Ally notices', group: 'Channels', type: 'channel' },
  { key: 'statusChannelId', label: 'ASOP status message', group: 'Channels', type: 'channel' },
  { key: 'starStringsChannelId', label: 'StarStrings updates', group: 'Channels', type: 'channel', help: 'Optional. New LIVE builds of StarStrings are announced here.' },
  { key: 'jobsChannelId', label: 'Job board posts', group: 'Channels', type: 'channel', help: 'Optional. Jobs are always on the website.' },

  { key: 'timezone', label: 'Time zone', group: 'General', type: 'timezone' },
  { key: 'dkpLabel', label: 'DKP currency name', group: 'General', type: 'text', maxLength: 30 },
  { key: 'lootDefaultMethod', label: 'Default loot method', group: 'General', type: 'enum', options: ['RANDOM_ROLL', 'DKP', 'SNAKE_DRAFT'] },
  { key: 'dkpDefaultAuctionDuration', label: 'Default auction length (hours)', group: 'General', type: 'int', min: 1, max: 168 },
  { key: 'dkpMinBid', label: 'Minimum bid', group: 'General', type: 'int', min: 0 },
  { key: 'rsiOrgTag', label: 'RSI org tag', group: 'General', type: 'text', maxLength: 20 },
  { key: 'allianceTag', label: 'Ally tag', group: 'General', type: 'text', maxLength: 4 },
  { key: 'activityHeatmapPublic', label: 'Members can see activity heat maps', group: 'General', type: 'boolean' },
  { key: 'tournamentHideElo', label: 'Hide tournament ELO', group: 'General', type: 'boolean' },

  { key: 'eventCreatorRoles', label: 'Can create events', group: 'Roles', type: 'roles' },
  { key: 'viewerRoles', label: 'Can view events and loot', group: 'Roles', type: 'roles' },
  { key: 'moduleEditorRoles', label: 'Can edit module settings', group: 'Roles', type: 'roles' },
  { key: 'lootDraftCreatorRoles', label: 'Can start loot sessions', group: 'Roles', type: 'roles' },
  { key: 'allianceManagerRoles', label: 'Can manage allies', group: 'Roles', type: 'roles' },
];

// ── Activity log and feed ───────────────────────────────────────────────────

export interface AdminLogDto {
  id: number;
  createdAt: string;
  kind: string;
  actorId: string | null;
  actorName: string | null;
  guildId: string | null;
  guildName: string | null;
  summary: string;
  details: Record<string, unknown>;
}

export interface AdminConfigDto {
  feedGuildId: string | null;
  feedChannelId: string | null;
  alertsEnabled: boolean;
  digestEnabled: boolean;
  digestHour: number;
  digestTimezone: string;
  lastDigestDate: string | null;
}

/** Kinds of AdminLog entries, for filters and labels. */
export const ADMIN_LOG_KINDS: Record<string, string> = {
  'guild.joined': 'Bot added to a server',
  'guild.left': 'Bot removed from a server',
  'admin.settings': 'Server settings changed by an admin',
  'admin.errors': 'Error kind marked',
  'admin.config': 'Admin feed settings changed',
  'admin.modules': 'Modules hidden or shown for every server',
  'admin.test': 'Admin feed test',
};
