import { svgToPng } from './bracketSvg.js';

// ── Layout ────────────────────────────────────────────────────────────────────

const CARD_W = 900;
const CARD_H = 320;

const COLOR_BG        = '#1e1f22';
const COLOR_HEADER    = '#111214';
const COLOR_SLOT      = '#2b2d31';
const COLOR_TEXT      = '#f2f3f5';
const COLOR_DIM       = '#72767d';
const COLOR_GREEN     = '#57f287';
const COLOR_BLURPLE   = '#5865f2';
const COLOR_GOLD      = '#faa61a';
const AVATAR_R        = 42; // circle radius

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

  const HEADER_H = 52;
  const cx = CARD_W / 2;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`);
  lines.push(`<style>text { font-family: 'DejaVu Sans', Arial, sans-serif; }</style>`);

  // Background
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${COLOR_BG}"/>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${HEADER_H}" fill="${COLOR_HEADER}"/>`);
  lines.push(`<line x1="0" y1="${HEADER_H}" x2="${CARD_W}" y2="${HEADER_H}" stroke="${COLOR_BLURPLE}" stroke-width="2"/>`);
  // Tournament name (left) and match label (right) in header
  lines.push(svgT(20, 32, truncate(tournamentName.toUpperCase(), 36), COLOR_DIM, 12, 'bold'));
  const matchLabel = `ROUND ${round}  ·  MATCH ${position + 1}`;
  lines.push(svgT(CARD_W - 20, 32, matchLabel, COLOR_BLURPLE, 12, 'bold', 'end'));

  // ── Avatar positions ──────────────────────────────────────────────────────
  const AX = 110;           // participant A center x
  const BX = CARD_W - 110;  // participant B center x
  const AY = HEADER_H + 76; // avatar center y

  renderAvatar(lines, AX, AY, avatarA, nameA, 'clipA');
  renderAvatar(lines, BX, AY, avatarB, nameB, 'clipB');

  // ── Names ─────────────────────────────────────────────────────────────────
  // Name area: below avatars
  const nameY = AY + AVATAR_R + 22;
  lines.push(svgT(AX, nameY, truncate(nameA, 12), COLOR_TEXT, 18, 'bold', 'middle'));
  lines.push(svgT(BX, nameY, truncate(nameB, 12), COLOR_TEXT, 18, 'bold', 'middle'));

  // Seed + rating below names
  const statsY = nameY + 22;
  if (participantA?.seed != null) {
    lines.push(svgT(AX, statsY, `SEED #${participantA.seed}`, COLOR_DIM, 10, 'bold', 'middle'));
  }
  const ratingA = formatRating(participantA?.rating ?? 1200, participantA?.matchesPlayed ?? 0);
  lines.push(svgT(AX, statsY + (participantA?.seed != null ? 14 : 0), ratingA + ' ELO', COLOR_DIM, 10, 'normal', 'middle'));

  if (participantB?.seed != null) {
    lines.push(svgT(BX, statsY, `SEED #${participantB.seed}`, COLOR_DIM, 10, 'bold', 'middle'));
  }
  const ratingB = formatRating(participantB?.rating ?? 1200, participantB?.matchesPlayed ?? 0);
  lines.push(svgT(BX, statsY + (participantB?.seed != null ? 14 : 0), ratingB + ' ELO', COLOR_DIM, 10, 'normal', 'middle'));

  // ── VS. center ────────────────────────────────────────────────────────────
  // Divider lines left and right of VS
  const vsY = AY;
  const divW = 90;
  lines.push(`<line x1="${cx - divW}" y1="${vsY}" x2="${cx - 28}" y2="${vsY}" stroke="${COLOR_SLOT}" stroke-width="1.5"/>`);
  lines.push(`<line x1="${cx + 28}" y1="${vsY}" x2="${cx + divW}" y2="${vsY}" stroke="${COLOR_SLOT}" stroke-width="1.5"/>`);
  lines.push(svgT(cx, vsY + 12, 'VS.', COLOR_BLURPLE, 30, 'bold', 'middle'));

  // Scheduled time badge (if set)
  if (scheduledAt) {
    const timeStr = scheduledAt.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
    const badgeY = CARD_H - 20;
    lines.push(`<rect x="${cx - 140}" y="${badgeY - 16}" width="280" height="22" rx="4" fill="${COLOR_SLOT}"/>`);
    lines.push(svgT(cx, badgeY, `🕐  ${timeStr}`, COLOR_DIM, 11, 'normal', 'middle'));
  }

  // clipPath defs (must come before elements that reference them)
  lines.splice(2, 0, `<defs>
    <clipPath id="clipA"><circle cx="${AX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipB"><circle cx="${BX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
  </defs>`);

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

  const HEADER_H = 52;
  const cx = CARD_W / 2;
  const AX = 110;
  const BX = CARD_W - 110;
  const AY = HEADER_H + 76;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`);
  lines.push(`<style>text { font-family: 'DejaVu Sans', Arial, sans-serif; }</style>`);
  lines.push(`<defs>
    <clipPath id="clipW"><circle cx="${AX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipL"><circle cx="${BX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Background
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${COLOR_BG}"/>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${HEADER_H}" fill="${COLOR_HEADER}"/>`);
  lines.push(`<line x1="0" y1="${HEADER_H}" x2="${CARD_W}" y2="${HEADER_H}" stroke="${COLOR_GREEN}" stroke-width="2"/>`);
  lines.push(svgT(20, 32, truncate(tournamentName.toUpperCase(), 36), COLOR_DIM, 12, 'bold'));
  lines.push(svgT(CARD_W - 20, 32, `ROUND ${round}  ·  MATCH ${position + 1} RESULT`, COLOR_GREEN, 12, 'bold', 'end'));

  // Avatars
  renderAvatar(lines, AX, AY, winAvatar, winName, 'clipW', COLOR_GREEN);
  if (loser) renderAvatar(lines, BX, AY, loseAvatar, loseName, 'clipL', '#404249');

  // Score or checkmark center
  const scoreY = AY - 8;
  if (scoreA != null && scoreB != null) {
    lines.push(svgT(cx, scoreY + 2, `${scoreA}  –  ${scoreB}`, COLOR_TEXT, 26, 'bold', 'middle'));
  } else {
    lines.push(svgT(cx, scoreY + 2, '✓', COLOR_GREEN, 32, 'bold', 'middle'));
  }
  lines.push(svgT(cx, scoreY + 24, 'FINAL', COLOR_DIM, 9, 'bold', 'middle'));

  // Names
  const nameY = AY + AVATAR_R + 22;
  lines.push(svgT(AX, nameY, truncate(winName, 12), COLOR_GREEN, 18, 'bold', 'middle'));
  if (loser) lines.push(svgT(BX, nameY, truncate(loseName, 12), COLOR_DIM, 16, 'normal', 'middle'));

  // ELO deltas
  const deltaStr = (d: number, plus = true) => (d >= 0 && plus ? `+${d}` : String(d));
  const eloY = nameY + 22;
  lines.push(svgT(AX, eloY, `${deltaStr(eloChangeWinner)} ELO  🏆`, COLOR_GREEN, 11, 'bold', 'middle'));
  if (loser) {
    lines.push(svgT(BX, eloY, `${deltaStr(eloChangeLoser)} ELO`, COLOR_DIM, 11, 'normal', 'middle'));
    lines.push(svgT(BX, eloY + 14, 'ELIMINATED', COLOR_DIM, 9, 'bold', 'middle'));
  }

  // Trophy badge below winner
  lines.push(svgT(AX, eloY + 14, 'WINNER', COLOR_GOLD, 9, 'bold', 'middle'));

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
