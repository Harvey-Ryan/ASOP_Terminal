// Shared types and utilities consumed by both @dem/api and @dem/web

// ── Generic API shapes ────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Discord CDN helpers ───────────────────────────────────────────────────────

export const DISCORD_CDN = 'https://cdn.discordapp.com';

/**
 * Returns a user's avatar URL from their Discord ID and avatar hash.
 * Animated avatars (hash starts with 'a_') use GIF format.
 */
export function getAvatarUrl(
  userId: string,
  avatarHash: string | null,
  size: 16 | 32 | 64 | 128 | 256 | 512 | 1024 = 128,
): string | null {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'webp';
  return `${DISCORD_CDN}/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
}

/**
 * Returns the default avatar URL for users without a custom avatar.
 * Discord's new username system uses a fixed 6-index cycle based on userId.
 */
export function getDefaultAvatarUrl(userId: string, discriminator: string): string {
  const index =
    discriminator === '0'
      ? Number(BigInt(userId) >> BigInt(22)) % 6  // new username system
      : parseInt(discriminator, 10) % 5;           // legacy discriminator system
  return `${DISCORD_CDN}/embed/avatars/${index}.png`;
}

/** Resolves the best avatar URL for a user, falling back to the default. */
export function resolveAvatarUrl(userId: string, discriminator: string, avatarHash: string | null): string {
  return getAvatarUrl(userId, avatarHash) ?? getDefaultAvatarUrl(userId, discriminator);
}

/**
 * Returns a guild's icon URL from its ID and icon hash.
 * Animated icons (hash starts with 'a_') use GIF format.
 */
export function getGuildIconUrl(
  guildId: string,
  iconHash: string | null,
  size: 16 | 32 | 64 | 128 | 256 | 512 | 1024 = 128,
): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'webp';
  return `${DISCORD_CDN}/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

// ── Discord permissions ───────────────────────────────────────────────────────

const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);

/**
 * Returns true if the guild entry (from /users/@me/guilds) grants the user
 * the ability to manage the server — i.e. they are the owner, have the
 * ADMINISTRATOR bit, or have the MANAGE_GUILD bit.
 */
export function canManageGuild(guild: { owner: boolean; permissions: string }): boolean {
  if (guild.owner) return true;
  try {
    const perms = BigInt(guild.permissions);
    return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

// ── Discord OAuth shapes ──────────────────────────────────────────────────────

/** Discord user profile returned by /api/auth/me */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  globalName: string | null;
  avatar: string | null;
  /** Resolved CDN avatar URL (includes animated GIF support, falls back to default) */
  avatarUrl: string;
  email?: string;
}

/** A Discord guild from /users/@me/guilds (raw Discord API shape) */
export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/**
 * A guild the authed user can manage — returned by /api/guilds.
 * hasBotInstalled will become true in Phase 2 once the bot is deployed.
 */
export interface ManagedGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Resolved CDN icon URL, or null if the guild has no icon */
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
  /** Phase 2: true when the bot is present in this guild */
  hasBotInstalled: boolean;
}

/** Shape returned by GET /api/auth/me */
export interface MeResponse {
  user: DiscordUser;
  guilds: ManagedGuild[];
}

// ── Guild membership ──────────────────────────────────────────────────────────

export type GuildRole = 'OWNER' | 'ADMIN' | 'ORGANIZER' | 'MEMBER';

// ── Events ────────────────────────────────────────────────────────────────────

export interface EventRole {
  name: string;
  count: number;
}

/** Body for POST /api/guilds/:guildId/events */
export interface CreateEventBody {
  name: string;
  description?: string;
  musterPoint?: string;
  /** ISO 8601 UTC string */
  startTime: string;
  /** ISO 8601 UTC string */
  endTime?: string;
  recurType?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  roles?: EventRole[];
  /** Names of voice channels to create 30 min before start */
  vcNames?: string[];
  /** Whether to create an additional PTT-enforced Briefing VC */
  briefingChannel?: boolean;
  /** URL path to cover image */
  imageUrl?: string;
  /** Stable template ID carried from the Repeat button or Templates list — records and updates the template on create */
  repeatFromTemplateId?: string;
}

export interface RsvpDto {
  userId: string;
  username: string;
  role: string | null;
}

/** Event as returned by the API */
export interface EventDto {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  musterPoint: string | null;
  startTime: string;
  endTime: string | null;
  recurType: string | null;
  roles: EventRole[];
  vcNames: string[];
  briefingChannel: boolean;
  imageUrl: string | null;
  vcIds: string[];
  discordEventId: string | null;
  threadId: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  rsvpCounts: { total: number };
  rsvps: RsvpDto[];
  hadLoot: boolean | null;
  lootNotes: string | null;
  vcAttendees: string[];
  confirmedAttendees: string[] | null;
  botCleanedUp: boolean;
}

// ── Loot ─────────────────────────────────────────────────────────────────────

export type LootMethod = 'RANDOM_ROLL' | 'DKP' | 'SNAKE_DRAFT';

export interface LootAssignmentDto {
  id: string;
  userId: string;
  username: string;
  rollValue: number | null;
  dkpSpent: number | null;
  pickNumber: number | null;
  assignedAt: string;
  delivered: boolean;
  deliveredAt: string | null;
}

export interface LootItemDto {
  id: string;
  name: string;
  quantity: number;
  excludePrevWinners: boolean;
  sortOrder: number;
  assignments: LootAssignmentDto[];
}

export interface LootSessionDto {
  id: string;
  eventId: string;
  guildId: string;
  method: LootMethod;
  status: 'OPEN' | 'COMPLETED';
  draftOrder: string[];
  draftStarted: boolean;
  skipCount: number;
  dkpAward: number;
  items: LootItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface DkpBalanceDto {
  userId: string;
  username: string;
  balance: number;
  updatedAt: string;
}

export interface DkpTransactionDto {
  id: string;
  userId: string;
  username: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface CreateLootSessionBody {
  method: LootMethod;
  dkpAward?: number;
}

export interface AddLootItemBody {
  name: string;
  quantity?: number;
  excludePrevWinners?: boolean;
}

export interface AssignLootItemBody {
  userId: string;
  username: string;
  dkpSpent?: number;
  pickNumber?: number;
}

// ── Guild settings ────────────────────────────────────────────────────────────

export interface DiscordRoleDto {
  id: string;
  name: string;
  color: number;
  position: number;
}

// ── Images ────────────────────────────────────────────────────────────────────

export interface ServerImageDto {
  id: string;
  guildId: string;
  filename: string;
  url: string;
  sortOrder: number;
  createdAt: string;
}


// ── Snake draft my-pick ───────────────────────────────────────────────────────

/** Returned by GET /api/guilds/loot/my-picks for every active snake draft the user participates in */
export interface MyPickDto {
  guildId: string;
  guildName: string;
  eventId: string;
  eventName: string;
  /** Number of unassigned items remaining in the session */
  itemCount: number;
  /** True when it is currently this user's turn to pick */
  isMyTurn: boolean;
}

// ── Event templates ───────────────────────────────────────────────────────────

/**
 * A single sign-up slot within an EventTemplate roster.
 * Stored as JSON in the database; validated with this type in application code.
 */
export interface RosterSlot {
  /** Stable local identifier (cuid or uuid) */
  id: string;
  /** Display name, e.g. "Tank", "Healer", "DPS" */
  name: string;
  /** Optional Discord emoji string, e.g. "🛡️" or a custom emoji snowflake */
  emoji?: string;
  /** Maximum number of players that can fill this slot */
  maxCount: number;
  /** Whether this slot must be filled before the event can start */
  required: boolean;
}

// ── Loot Auctions ─────────────────────────────────────────────────────────────

export interface LootAuctionBidDto {
  userId: string;
  username: string;
  amount: number;
  maxBid: number;
  placedAt: string;
}

export interface LootAuctionDto {
  id: string;
  itemId: string;
  itemName: string;
  sessionId: string;
  guildId: string;
  durationSecs: number;
  closesAt: string;
  /** Seconds until auction closes; 0 when expired/closed. */
  secondsRemaining: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  winnerId: string | null;
  winnerUsername: string | null;
  winningBid: number | null;
  /** Sorted by amount descending. */
  bids: LootAuctionBidDto[];
  createdAt: string;
  updatedAt: string;
}

// ── Standalone Auctions ───────────────────────────────────────────────────────

export interface AuctionBidDto {
  userId: string;
  username: string;
  amount: number;
  maxBid: number;
  placedAt: string;
}

export interface AuctionDto {
  id: string;
  guildId: string;
  eventId: string | null;
  title: string;
  description: string | null;
  durationSecs: number;
  closesAt: string;
  secondsRemaining: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  winnerId: string | null;
  winnerUsername: string | null;
  winningBid: number | null;
  bids: AuctionBidDto[];
  createdAt: string;
  updatedAt: string;
}

// ── Snake draft queue ─────────────────────────────────────────────────────────

export interface LootQueueItemDto {
  itemId: string;
  itemName: string;
  /** Lower = higher priority (0 = first pick) */
  priority: number;
  /** True when the item has been assigned to anyone */
  assigned: boolean;
}

// ── Proxy bidding algorithm ───────────────────────────────────────────────────
// Returns a map of userId → effective current bid.
// Winner pays runner-up + increment; all others show their max bid.
export function resolveProxy(
  bids: { userId: string; maxBid: number; placedAt: Date }[],
  increment = 1,
): Map<string, number> {
  if (bids.length === 0) return new Map();
  const sorted = [...bids].sort((a, b) =>
    b.maxBid !== a.maxBid
      ? b.maxBid - a.maxBid
      : a.placedAt.getTime() - b.placedAt.getTime(),
  );
  const result = new Map<string, number>();
  const winner = sorted[0]!;
  const runnerUp = sorted[1];
  if (!runnerUp) {
    result.set(winner.userId, winner.maxBid);
  } else {
    result.set(winner.userId, Math.min(winner.maxBid, runnerUp.maxBid + increment));
    for (let i = 1; i < sorted.length; i++) {
      result.set(sorted[i]!.userId, sorted[i]!.maxBid);
    }
  }
  return result;
}

// ── UEX Corp Game Data ────────────────────────────────────────────────────────

export interface UexAttributeDto {
  name: string;
  value: string;
  unit: string;
}

export interface UexCategoryDto {
  id: number;
  type: string;
  section: string;
  name: string;
}

export interface UexItemDto {
  id: number;
  name: string;
  slug: string;
  categoryId: number;
  categoryName: string;
  section: string | null;
  size: string | null;
  isCommodity: boolean;
  isHarvestable: boolean;
  gameVersion: string | null;
  attributes: UexAttributeDto[];
}

export interface UexCommodityDto {
  id: number;
  name: string;
  code: string;
  slug: string;
  weightScu: number | null;
  priceAvgBuy: number | null;
  priceAvgSell: number | null;
  isMineral: boolean;
  isRaw: boolean;
  isRefined: boolean;
  isHarvestable: boolean;
  isFuel: boolean;
  isIllegal: boolean;
}

export interface UexSyncLogDto {
  id: string;
  trigger: string;
  status: string;
  categoriesAdded: number;
  categoriesUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  commoditiesAdded: number;
  commoditiesUpdated: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface UexSyncStatusDto {
  isRunning: boolean;
  lastSync: UexSyncLogDto | null;
  counts: {
    categories: number;
    items: number;
    commodities: number;
  };
}

/** A reusable event blueprint, auto-created on Repeat and surfaced in the create-event form. */
export interface EventTemplateDto {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  musterPoint: string | null;
  imageUrl: string | null;
  roles: EventRole[];
  vcNames: string[];
  briefingChannel: boolean;
  rosterSlots: RosterSlot[];
  reminderMinutes: number[];
  defaultDuration: number | null;
  isActive: boolean;
  createdById: string;
  /** Number of times used to create an event in the last 6 months. */
  useCount: number;
  createdAt: string;
  updatedAt: string;
}
