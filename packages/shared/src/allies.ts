// Ally network rules: which org may send, accept, reject, block, cancel or
// remove an ally link, and whose setting decides whether a shared event posts
// automatically. Pure functions only, so the API routes, the bot's Discord
// buttons and the start-up migration all apply the same rules.
//
// A pair of orgs is ONE row (GuildAlly), whichever side asked. Guild ids here
// are the internal Guild.id values (not Discord snowflakes); the pair is stored
// in sorted order (guildAId < guildBId).

export type AllyStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';

/** Days a rejected org waits before asking again. */
export const ALLY_RETRY_DAYS = 7;
/** Open requests an org may have out at once. */
export const ALLY_MAX_OUTGOING = 10;
/** Longest note that can ride along with a request. */
export const ALLY_MESSAGE_MAX = 200;

/** The parts of a GuildAlly row the rules look at. */
export interface AllyLink {
  guildAId: string;
  guildBId: string;
  status: AllyStatus;
  /** The side that sent the current (or last) request. */
  requestedByGuildId: string;
  retryAfter: Date | null;
  blockedByGuildId: string | null;
  /** Side A posts side B's events automatically. */
  autoAcceptA: boolean;
  /** Side B posts side A's events automatically. */
  autoAcceptB: boolean;
}

// ── The pair ─────────────────────────────────────────────────────────────────

/** The two ids in stored order. Throws for the same id twice. */
export function sortPair(x: string, y: string): [string, string] {
  if (x === y) throw new Error('An org cannot be paired with itself');
  return x < y ? [x, y] : [y, x];
}

export function inPair(link: Pick<AllyLink, 'guildAId' | 'guildBId'>, guildId: string): boolean {
  return link.guildAId === guildId || link.guildBId === guildId;
}

/** The other org in the pair. Throws if `guildId` isn't in it. */
export function otherGuild(link: Pick<AllyLink, 'guildAId' | 'guildBId'>, guildId: string): string {
  if (link.guildAId === guildId) return link.guildBId;
  if (link.guildBId === guildId) return link.guildAId;
  throw new Error('Guild is not in this pair');
}

/** The column holding `guildId`'s own "post their events automatically" setting. */
export function autoAcceptField(link: Pick<AllyLink, 'guildAId' | 'guildBId'>, guildId: string): 'autoAcceptA' | 'autoAcceptB' {
  if (link.guildAId === guildId) return 'autoAcceptA';
  if (link.guildBId === guildId) return 'autoAcceptB';
  throw new Error('Guild is not in this pair');
}

/** Whether the receiving org has chosen to post this ally's events automatically. */
export function receiverAutoAccepts(link: AllyLink, receiverGuildId: string): boolean {
  return link[autoAcceptField(link, receiverGuildId)];
}

/** Whether two orgs may share events: only allies can. */
export function canShareEvents(link: AllyLink | null | undefined): boolean {
  return !!link && link.status === 'ACCEPTED';
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type AllyRefusal =
  | 'self'              // asking yourself
  | 'already-allies'
  | 'already-requested' // your request is still pending
  | 'blocked'           // they blocked you (worded neutrally to the requester)
  | 'you-blocked'       // you blocked them: unblock first
  | 'retry-later'       // they rejected you less than ALLY_RETRY_DAYS ago
  | 'not-pending'
  | 'not-yours'         // acting on a request or link that isn't yours to act on
  | 'not-allies';

export type Decision<T> = ({ ok: true } & T) | { ok: false; refusal: AllyRefusal; retryAfter?: Date };

const no = (refusal: AllyRefusal, retryAfter?: Date) => ({ ok: false as const, refusal, ...(retryAfter ? { retryAfter } : {}) });

/**
 * Sending a request from `fromId` to `toId`, given the pair's current row (or none).
 * - `create`: no row yet
 * - `reopen`: a rejected request may be sent again (turns the row back into PENDING)
 * - `accept`: the other side had already asked, so this request accepts theirs
 */
export function decideRequest(
  link: AllyLink | null,
  fromId: string,
  toId: string,
  now: Date,
): Decision<{ action: 'create' | 'reopen' | 'accept' }> {
  if (fromId === toId) return no('self');
  if (!link) return { ok: true, action: 'create' };
  switch (link.status) {
    case 'ACCEPTED':
      return no('already-allies');
    case 'PENDING':
      return link.requestedByGuildId === fromId ? no('already-requested') : { ok: true, action: 'accept' };
    case 'BLOCKED':
      return link.blockedByGuildId === fromId ? no('you-blocked') : no('blocked');
    case 'REJECTED':
      // They turned down your request: wait out the cooldown. If it was the
      // other way round (you turned them down), you may ask them any time.
      if (link.requestedByGuildId === fromId && link.retryAfter && now < link.retryAfter) {
        return no('retry-later', link.retryAfter);
      }
      return { ok: true, action: 'reopen' };
  }
}

/** Accepting, rejecting, or rejecting and blocking a pending request: only the side that was asked. */
export function decideResponse(link: AllyLink, actorId: string): Decision<object> {
  if (!inPair(link, actorId)) return no('not-yours');
  if (link.status !== 'PENDING') return no('not-pending');
  if (link.requestedByGuildId === actorId) return no('not-yours');
  return { ok: true };
}

/** Withdrawing a pending request: only the side that sent it. */
export function decideCancel(link: AllyLink, actorId: string): Decision<object> {
  if (!inPair(link, actorId)) return no('not-yours');
  if (link.status !== 'PENDING') return no('not-pending');
  if (link.requestedByGuildId !== actorId) return no('not-yours');
  return { ok: true };
}

/** Ending an alliance, or changing your own auto-post setting for an ally: either side. */
export function decideAllyChange(link: AllyLink, actorId: string): Decision<object> {
  if (!inPair(link, actorId)) return no('not-yours');
  if (link.status !== 'ACCEPTED') return no('not-allies');
  return { ok: true };
}

/** Lifting a block: only the side that blocked. */
export function decideUnblock(link: AllyLink, actorId: string): Decision<object> {
  if (!inPair(link, actorId) || link.status !== 'BLOCKED' || link.blockedByGuildId !== actorId) return no('not-yours');
  return { ok: true };
}

export type AllyResponse = 'accept' | 'reject' | 'block';

/**
 * The columns an answer to a pending request changes. Used by the API (the
 * Allies page) and the bot (the Discord buttons), so both record an answer
 * the same way.
 */
export function responseChanges(action: AllyResponse, responderGuildId: string, responderUserId: string | null, now: Date) {
  switch (action) {
    case 'accept':
      return { status: 'ACCEPTED' as const, respondedAt: now, acceptedAt: now, respondedBy: responderUserId, retryAfter: null };
    case 'reject':
      return { status: 'REJECTED' as const, respondedAt: now, respondedBy: responderUserId, retryAfter: retryAfterFrom(now) };
    case 'block':
      return { status: 'BLOCKED' as const, respondedAt: now, respondedBy: responderUserId, blockedByGuildId: responderGuildId, retryAfter: null };
  }
}

/** When a rejected requester may ask again. */
export function retryAfterFrom(rejectedAt: Date): Date {
  return new Date(rejectedAt.getTime() + ALLY_RETRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Words for a refusal, as shown to the org that tried. */
export function allyRefusalMessage(refusal: AllyRefusal, retryAfter?: Date): string {
  switch (refusal) {
    case 'self': return "You can't send an ally request to your own org.";
    case 'already-allies': return 'You are already allies.';
    case 'already-requested': return 'Your request is already waiting for an answer.';
    case 'blocked': return "This org isn't accepting ally requests from you.";
    case 'you-blocked': return 'You blocked this org. Unblock it first.';
    case 'retry-later': return `This org declined your last request. You can ask again after ${retryAfter ? retryAfter.toISOString().slice(0, 10) : 'the waiting period'}.`;
    case 'not-pending': return 'This request has already been answered or withdrawn.';
    case 'not-yours': return "That isn't yours to change.";
    case 'not-allies': return 'You are not allies with this org.';
  }
}

// ── Discord notices (API → bot) ──────────────────────────────────────────────

/** What happened, for the bot's ally notices. */
export type AllyNoticeEvent = 'requested' | 'accepted' | 'rejected' | 'blocked' | 'cancelled' | 'removed';

/**
 * Sent by the API to the bot after an ally change. Guild ids are internal
 * Guild.id values. The notice ids are included because a cancelled or removed
 * link is deleted before the bot sees it.
 *
 * - requested: actor asked other → request message with buttons in other's channel
 * - accepted / rejected / blocked: actor answered other's request → the request
 *   message is edited; accepted and rejected are also posted to other (a block isn't)
 * - cancelled: actor withdrew its request → the request message is edited
 * - removed: actor ended the alliance → posted to other
 */
export interface AllyNoticePayload {
  event: AllyNoticeEvent;
  linkId: string;
  actorGuildId: string;
  otherGuildId: string;
  /** Discord user id of whoever clicked. */
  actorUserId: string | null;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
}

export const ALLY_NOTICE_EVENTS: readonly AllyNoticeEvent[] = ['requested', 'accepted', 'rejected', 'blocked', 'cancelled', 'removed'];

export function isAllyNoticePayload(x: unknown): x is AllyNoticePayload {
  const p = x as Partial<AllyNoticePayload> | null;
  return !!p && typeof p === 'object'
    && ALLY_NOTICE_EVENTS.includes(p.event as AllyNoticeEvent)
    && typeof p.linkId === 'string' && typeof p.actorGuildId === 'string' && typeof p.otherGuildId === 'string'
    && (p.actorUserId === null || typeof p.actorUserId === 'string')
    && (p.noticeChannelId === null || typeof p.noticeChannelId === 'string')
    && (p.noticeMessageId === null || typeof p.noticeMessageId === 'string');
}

/** customId of an ally request button: `ally:<accept|reject|block>:<linkId>`. */
export function allyButtonId(action: AllyResponse, linkId: string): string {
  return `ally:${action}:${linkId}`;
}

export function parseAllyButtonId(customId: string): { action: AllyResponse; linkId: string } | null {
  const m = /^ally:(accept|reject|block):([A-Za-z0-9_-]{1,60})$/.exec(customId);
  return m ? { action: m[1] as AllyResponse, linkId: m[2]! } : null;
}

// ── Sharing events with allies (v1.11.0) ────────────────────────────────────

/** Who gets a new share of an event, by internal Guild.id. */
export interface SharePlan {
  /** Allies that post the host's events automatically: share starts ACCEPTED. */
  accepted: string[];
  /** Allies that approve each event: share starts PENDING. */
  pending: string[];
  /** Asked for, but not allies with the host: no share. */
  notAllies: string[];
}

/**
 * Only allies can receive an event. Each ally's own "Their events" setting
 * decides whether it's posted straight away or waits for an officer. Targets
 * are de-duplicated and the host itself is ignored.
 */
export function planShares(hostGuildId: string, targetGuildIds: readonly string[], links: readonly AllyLink[]): SharePlan {
  const plan: SharePlan = { accepted: [], pending: [], notAllies: [] };
  for (const target of new Set(targetGuildIds)) {
    if (target === hostGuildId) continue;
    const link = links.find((l) => inPair(l, hostGuildId) && inPair(l, target));
    if (!link || !canShareEvents(link)) plan.notAllies.push(target);
    else if (receiverAutoAccepts(link, target)) plan.accepted.push(target);
    else plan.pending.push(target);
  }
  return plan;
}

/**
 * Removing an ally withdraws the invitations still waiting between the two orgs,
 * in both directions. Accepted shares stay until the event ends.
 */
export function withdrawnOnRemoval(
  share: { status: 'PENDING' | 'ACCEPTED' | 'DECLINED'; hostGuildId: string; guildId: string },
  pair: Pick<AllyLink, 'guildAId' | 'guildBId'>,
): boolean {
  return share.status === 'PENDING' && share.hostGuildId !== share.guildId
    && inPair(pair, share.hostGuildId) && inPair(pair, share.guildId);
}

export const NOT_ALLY_MESSAGE = 'You can only share events with your allies. Add them on the Allies page first.';

export type ShareResponse = 'accept' | 'decline';

/** What happened to a shared event invitation, for the bot's notices. */
export type ShareNoticeEvent = 'pending' | 'accepted' | 'declined' | 'withdrawn';

/**
 * Sent by the API (and the bot itself) after a share changes. Guild ids are
 * internal Guild.id values.
 *
 * - pending: host shared an event with receiver, waiting for approval → message
 *   with Accept / Decline / Open in the receiver's ally notices channel
 * - accepted / declined: receiver answered → that message is edited
 * - withdrawn: host cancelled the invitation, or the alliance ended → edited.
 *   The share row may already be gone, so the notice ids and names come along.
 */
export interface ShareNoticePayload {
  event: ShareNoticeEvent;
  shareId: string;
  eventId: string;
  hostGuildId: string;
  receiverGuildId: string;
  actorUserId: string | null;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
}

export const SHARE_NOTICE_EVENTS: readonly ShareNoticeEvent[] = ['pending', 'accepted', 'declined', 'withdrawn'];

export function isShareNoticePayload(x: unknown): x is ShareNoticePayload {
  const p = x as Partial<ShareNoticePayload> | null;
  return !!p && typeof p === 'object'
    && SHARE_NOTICE_EVENTS.includes(p.event as ShareNoticeEvent)
    && typeof p.shareId === 'string' && typeof p.eventId === 'string'
    && typeof p.hostGuildId === 'string' && typeof p.receiverGuildId === 'string'
    && (p.actorUserId === null || typeof p.actorUserId === 'string')
    && (p.noticeChannelId === null || typeof p.noticeChannelId === 'string')
    && (p.noticeMessageId === null || typeof p.noticeMessageId === 'string');
}

/** customId of a shared-event button: `share:<accept|decline>:<shareId>`. */
export function shareButtonId(action: ShareResponse, shareId: string): string {
  return `share:${action}:${shareId}`;
}

export function parseShareButtonId(customId: string): { action: ShareResponse; shareId: string } | null {
  const m = /^share:(accept|decline):([A-Za-z0-9_-]{1,60})$/.exec(customId);
  return m ? { action: m[1] as ShareResponse, shareId: m[2]! } : null;
}

// ── Ally codes ───────────────────────────────────────────────────────────────

/** No 0/O or 1/I, so a code read aloud or retyped can't be misread. */
export const ALLY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ALLY_CODE_LENGTH = 8;

/** A new code from random bytes (pass crypto.randomBytes(8) or similar). */
export function allyCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < ALLY_CODE_LENGTH) throw new Error(`Need ${ALLY_CODE_LENGTH} random bytes`);
  let out = '';
  // 256 is a multiple of 32, so `% 32` adds no bias.
  for (let i = 0; i < ALLY_CODE_LENGTH; i++) out += ALLY_CODE_ALPHABET[bytes[i]! % ALLY_CODE_ALPHABET.length];
  return out;
}

/** "abcd-efgh", " ABCD EFGH " → "ABCDEFGH"; null if it can't be a code. */
export function normalizeAllyCode(input: string | null | undefined): string | null {
  const s = (input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== ALLY_CODE_LENGTH) return null;
  for (const ch of s) if (!ALLY_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** "ABCDEFGH" → "ABCD-EFGH" for display. */
export function formatAllyCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// ── API shapes ───────────────────────────────────────────────────────────────

export interface AllyGuildDto {
  /** Discord snowflake. */
  guildId: string;
  name: string;
  icon: string | null;
  allianceTag: string | null;
  rsiOrgTag: string | null;
}

export interface AllyDto {
  id: string;
  guild: AllyGuildDto;
  /** When the link was accepted. */
  since: string;
  /** Your setting: post this ally's events in your Discord without asking. */
  autoAcceptTheirEvents: boolean;
}

export interface AllyRequestDto {
  id: string;
  guild: AllyGuildDto;
  message: string | null;
  requestedAt: string;
}

export interface AllyOutgoingDto extends AllyRequestDto {
  status: 'PENDING' | 'REJECTED';
  /** For a rejected request: when you can ask again. */
  retryAfter: string | null;
}

export interface AllyBlockDto {
  id: string;
  guild: AllyGuildDto;
  blockedAt: string;
}

export interface AlliesOverviewDto {
  allies: AllyDto[];
  incoming: AllyRequestDto[];
  outgoing: AllyOutgoingDto[];
  blocked: AllyBlockDto[];
  listing: { listed: boolean; code: string };
  /** Incoming requests waiting for an answer (the nav badge). */
  pendingCount: number;
}

export interface AllyDirectoryEntryDto {
  guild: AllyGuildDto;
  /** False when a request can't be sent right now; `reason` says why. */
  requestable: boolean;
  reason: string | null;
}

export interface SendAllyRequestBody {
  /** Discord snowflake of an org from the directory… */
  targetGuildId?: string;
  /** …or its ally code. */
  code?: string;
  message?: string;
}

export interface SendAllyRequestResult {
  /** `accepted` when the other org had already asked you. */
  outcome: 'requested' | 'accepted';
  guild: AllyGuildDto;
}

/** An ally you can share an event with (the event form's picker). */
export interface ShareableAllyDto {
  guild: AllyGuildDto;
  /** That ally posts your events automatically; otherwise its officers approve each one. */
  postsAutomatically: boolean;
}

export interface ShareableAlliesDto {
  /** Your own org, for the role-slot server labels. */
  host: AllyGuildDto;
  allies: ShareableAllyDto[];
}
