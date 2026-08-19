import { svgToPng } from './bracketSvg.js';

// ── Layout ────────────────────────────────────────────────────────────────────
// Card is rendered at CARD_W px then Discord scales it to ~400px wide in embeds.
// Keep the canvas tight so text stays legible after scaling.

const CARD_W   = 700;
const CARD_H   = 320;
const HEADER_H = 46;

// Avatars live in the upper half; VS. + names drop into the lower half.
// AVATAR_R drives everything — bump it to use more vertical space.
const AVATAR_R = 76;

// Derived positions — AY_AVATAR is chosen so that the gap above the avatar
// circles (AY_AVATAR - AVATAR_R - HEADER_H) equals the gap below the last
// text row (CARD_H - AY_STATS - 14), centering all content in the body.
// With CARD_H=320, HEADER_H=46, AVATAR_R=76:  AY_AVATAR = 141
const AY_AVATAR = 141;
const AY_VS     = AY_AVATAR + AVATAR_R + 24;         // VS baseline (below avatar bottom)
const AY_NAME   = AY_VS + 28;                        // name baseline
const AY_STATS  = AY_NAME + 18;                      // seed/rating baseline

const COLOR_BG        = '#1e1f22';
const COLOR_HEADER    = '#111214';
const COLOR_SLOT      = '#2b2d31';
const COLOR_TEXT      = '#f2f3f5';
const COLOR_DIM       = '#72767d';
const COLOR_GREEN     = '#57f287';
const COLOR_BLURPLE   = '#5865f2';
const COLOR_GOLD      = '#faa61a';

// 60-second in-memory cache for Discord CDN avatar fetches
interface AvatarEntry { dataUri: string; expiresAt: number }
const avatarCache = new Map<string, AvatarEntry>();
const AVATAR_TTL = 60_000;

async function fetchAvatarDataUri(discordId: string, avatarHash: string | null): Promise<string | null> {
  const key = `${discordId}:${avatarHash ?? 'default'}`;
  const cached = avatarCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.dataUri;

  const url = avatarHash
    ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(discordId) % 5}.png`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    avatarCache.set(key, { dataUri, expiresAt: Date.now() + AVATAR_TTL });
    return dataUri;
  } catch {
    return null;
  }
}

// Deterministic color from name hash (fallback when no avatar)
function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},60%,40%)`;
}

// ── Match card SVG ────────────────────────────────────────────────────────────

export interface MatchCardParticipant {
  discordId: string | null;
  avatarHash: string | null;
  displayName: string;
  seed: number | null;
  rating: number;
  matchesPlayed: number;
}

export interface MatchCardData {
  tournamentName: string;
  round: number;
  position: number;
  scheduledAt: Date | null;
  participantA: MatchCardParticipant | null;
  participantB: MatchCardParticipant | null;
}

export async function buildMatchCardPng(data: MatchCardData): Promise<Buffer> {
  const svg = await buildMatchCardSvg(data);
  return svgToPng(svg, CARD_W);
}

export async function buildMatchCardSvg(data: MatchCardData): Promise<string> {
  const { tournamentName, round, position, scheduledAt, participantA, participantB } = data;

  const [avatarA, avatarB] = await Promise.all([
    participantA?.discordId ? fetchAvatarDataUri(participantA.discordId, participantA.avatarHash) : Promise.resolve(null),
    participantB?.discordId ? fetchAvatarDataUri(participantB.discordId, participantB.avatarHash) : Promise.resolve(null),
  ]);

  const nameA = (participantA?.displayName ?? 'TBD').toUpperCase();
  const nameB = (participantB?.displayName ?? 'TBD').toUpperCase();

  const cx = CARD_W / 2;
  // Avatars: symmetric around center, inset enough that the circles don't clip edges
  const AX = Math.round(CARD_W * 0.18);   // left  avatar center x
  const BX = CARD_W - AX;                 // right avatar center x (symmetric)

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`);
  lines.push(`<style>text { font-family: 'DejaVu Sans', Arial, sans-serif; }</style>`);
  lines.push(`<defs>
    <clipPath id="clipA"><circle cx="${AX}" cy="${AY_AVATAR}" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipB"><circle cx="${BX}" cy="${AY_AVATAR}" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Background
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${COLOR_BG}"/>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${HEADER_H}" fill="${COLOR_HEADER}"/>`);
  lines.push(`<line x1="0" y1="${HEADER_H}" x2="${CARD_W}" y2="${HEADER_H}" stroke="${COLOR_BLURPLE}" stroke-width="2"/>`);
  lines.push(svgT(16, HEADER_H - 14, truncate(tournamentName.toUpperCase(), 28), COLOR_DIM, 11, 'bold'));
  const matchLabel = `ROUND ${round}  ·  MATCH ${position + 1}`;
  lines.push(svgT(CARD_W - 16, HEADER_H - 14, matchLabel, COLOR_BLURPLE, 11, 'bold', 'end'));

  // ── Avatars (upper half) ──────────────────────────────────────────────────
  renderAvatar(lines, AX, AY_AVATAR, avatarA, nameA, 'clipA');
  renderAvatar(lines, BX, AY_AVATAR, avatarB, nameB, 'clipB');

  // ── VS. — centered below avatars ──────────────────────────────────────────
  // Short horizontal rules flanking VS.
  const ruleGap = 28;
  const ruleStartX = AX + AVATAR_R + 8;
  lines.push(`<line x1="${ruleStartX}" y1="${AY_VS - 10}" x2="${cx - ruleGap}" y2="${AY_VS - 10}" stroke="${COLOR_SLOT}" stroke-width="1"/>`);
  lines.push(`<line x1="${cx + ruleGap}" y1="${AY_VS - 10}" x2="${CARD_W - ruleStartX}" y2="${AY_VS - 10}" stroke="${COLOR_SLOT}" stroke-width="1"/>`);
  lines.push(svgT(cx, AY_VS, 'VS.', COLOR_BLURPLE, 38, 'bold', 'middle'));

  // ── Names — large bold uppercase, below VS. ───────────────────────────────
  lines.push(svgT(AX, AY_NAME, truncate(nameA, 10), COLOR_TEXT, 22, 'bold', 'middle'));
  lines.push(svgT(BX, AY_NAME, truncate(nameB, 10), COLOR_TEXT, 22, 'bold', 'middle'));

  // ── Seed + rating ─────────────────────────────────────────────────────────
  const statA = [
    participantA?.seed != null ? `SEED #${participantA.seed}` : null,
    formatRating(participantA?.rating ?? 1200, participantA?.matchesPlayed ?? 0) + ' ELO',
  ].filter(Boolean).join('  ·  ');
  const statB = [
    participantB?.seed != null ? `SEED #${participantB.seed}` : null,
    formatRating(participantB?.rating ?? 1200, participantB?.matchesPlayed ?? 0) + ' ELO',
  ].filter(Boolean).join('  ·  ');
  lines.push(svgT(AX, AY_STATS, statA, COLOR_DIM, 10, 'normal', 'middle'));
  lines.push(svgT(BX, AY_STATS, statB, COLOR_DIM, 10, 'normal', 'middle'));

  // ── Scheduled time badge ──────────────────────────────────────────────────
  if (scheduledAt) {
    const timeStr = scheduledAt.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
    const badgeY = CARD_H - 8;
    const badgeW = 260;
    lines.push(`<rect x="${cx - badgeW / 2}" y="${badgeY - 18}" width="${badgeW}" height="22" rx="4" fill="${COLOR_SLOT}"/>`);
    lines.push(svgT(cx, badgeY - 2, `🕐  ${timeStr}`, COLOR_DIM, 11, 'normal', 'middle'));
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ── Result card SVG ───────────────────────────────────────────────────────────

export interface ResultCardData {
  tournamentName: string;
  round: number;
  position: number;
  winner: MatchCardParticipant;
  loser: MatchCardParticipant | null;
  scoreA: number | null;
  scoreB: null | number;
  eloChangeWinner: number;
  eloChangeLoser: number;
}

export async function buildResultCardPng(data: ResultCardData): Promise<Buffer> {
  const svg = await buildResultCardSvg(data);
  return svgToPng(svg, CARD_W);
}

export async function buildResultCardSvg(data: ResultCardData): Promise<string> {
  const { tournamentName, round, position, winner, loser, scoreA, scoreB, eloChangeWinner, eloChangeLoser } = data;

  const [winAvatar, loseAvatar] = await Promise.all([
    winner.discordId ? fetchAvatarDataUri(winner.discordId, winner.avatarHash) : Promise.resolve(null),
    loser?.discordId ? fetchAvatarDataUri(loser.discordId, loser.avatarHash) : Promise.resolve(null),
  ]);

  const winName  = winner.displayName.toUpperCase();
  const loseName = loser?.displayName.toUpperCase() ?? '';

  const cx = CARD_W / 2;
  const AX = Math.round(CARD_W * 0.18);
  const BX = CARD_W - AX;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`);
  lines.push(`<style>text { font-family: 'DejaVu Sans', Arial, sans-serif; }</style>`);
  lines.push(`<defs>
    <clipPath id="clipW"><circle cx="${AX}" cy="${AY_AVATAR}" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipL"><circle cx="${BX}" cy="${AY_AVATAR}" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Background
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${COLOR_BG}"/>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${HEADER_H}" fill="${COLOR_HEADER}"/>`);
  lines.push(`<line x1="0" y1="${HEADER_H}" x2="${CARD_W}" y2="${HEADER_H}" stroke="${COLOR_GREEN}" stroke-width="2"/>`);
  lines.push(svgT(16, HEADER_H - 14, truncate(tournamentName.toUpperCase(), 28), COLOR_DIM, 11, 'bold'));
  lines.push(svgT(CARD_W - 16, HEADER_H - 14, `ROUND ${round}  ·  MATCH ${position + 1} RESULT`, COLOR_GREEN, 11, 'bold', 'end'));

  // Avatars (upper half — same positions as match card)
  renderAvatar(lines, AX, AY_AVATAR, winAvatar, winName, 'clipW', COLOR_GREEN);
  if (loser) renderAvatar(lines, BX, AY_AVATAR, loseAvatar, loseName, 'clipL', '#404249');

  // Score / checkmark — centered below avatars where VS. lives on match card
  if (scoreA != null && scoreB != null) {
    lines.push(svgT(cx, AY_VS, `${scoreA}  –  ${scoreB}`, COLOR_TEXT, 28, 'bold', 'middle'));
  } else {
    lines.push(svgT(cx, AY_VS, '✓', COLOR_GREEN, 34, 'bold', 'middle'));
  }
  lines.push(svgT(cx, AY_VS + 18, 'FINAL', COLOR_DIM, 9, 'bold', 'middle'));

  // Names — below score (same y as match card names)
  lines.push(svgT(AX, AY_NAME, truncate(winName, 10), COLOR_GREEN, 22, 'bold', 'middle'));
  if (loser) lines.push(svgT(BX, AY_NAME, truncate(loseName, 10), COLOR_DIM, 20, 'normal', 'middle'));

  // ELO deltas — same y as stats row
  const deltaStr = (d: number) => (d >= 0 ? `+${d}` : String(d));
  lines.push(svgT(AX, AY_STATS,      `${deltaStr(eloChangeWinner)} ELO`, COLOR_GREEN, 11, 'bold', 'middle'));
  lines.push(svgT(AX, AY_STATS + 14, 'WINNER', COLOR_GOLD, 9, 'bold', 'middle'));
  if (loser) {
    lines.push(svgT(BX, AY_STATS,      `${deltaStr(eloChangeLoser)} ELO`, COLOR_DIM, 11, 'normal', 'middle'));
    lines.push(svgT(BX, AY_STATS + 14, 'ELIMINATED', COLOR_DIM, 9, 'bold', 'middle'));
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ── helpers ───────────────────────────────────────────────────────────────────

function renderAvatar(
  out: string[],
  cx: number, cy: number,
  avatarDataUri: string | null,
  name: string,
  clipId: string,
  borderColor = '#404249',
): void {
  const r = AVATAR_R;
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="${borderColor}" stroke-width="2.5"/>`);
  if (avatarDataUri) {
    out.push(`<image href="${avatarDataUri}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${clipId})"/>`);
  } else {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${nameColor(name)}"/>`);
    const initial = name[0]?.toUpperCase() ?? '?';
    out.push(svgT(cx, cy + 9, initial, '#fff', 24, 'bold', 'middle'));
  }
}

function svgT(x: number, y: number, text: string, fill: string, size: number, weight = 'normal', anchor = 'start'): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="'DejaVu Sans',Arial,sans-serif">${escaped}</text>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatRating(rating: number, matchesPlayed: number): string {
  return matchesPlayed < 10 ? `~${rating}` : String(rating);
}
