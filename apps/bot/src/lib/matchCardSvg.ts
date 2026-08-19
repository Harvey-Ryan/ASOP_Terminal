import { svgToPng } from './bracketSvg.js';

// ── Layout ────────────────────────────────────────────────────────────────────
// Card is rendered at CARD_W px then Discord scales it to ~400px wide in embeds.
// Keep the canvas tight so text stays legible after scaling.

const CARD_W = 700;
const CARD_H = 300;

const COLOR_BG        = '#1e1f22';
const COLOR_HEADER    = '#111214';
const COLOR_SLOT      = '#2b2d31';
const COLOR_TEXT      = '#f2f3f5';
const COLOR_DIM       = '#72767d';
const COLOR_GREEN     = '#57f287';
const COLOR_BLURPLE   = '#5865f2';
const COLOR_GOLD      = '#faa61a';
const AVATAR_R        = 58; // circle radius — larger for better presence

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

  const HEADER_H = 46;
  const cx = CARD_W / 2;

  // Avatar centers — keep avatars away from edges; VS. sits exactly at center
  const AX = Math.round(CARD_W * 0.175);   // ~122 for 700px
  const BX = CARD_W - AX;                  // symmetric
  const AY = HEADER_H + AVATAR_R + 14;     // snug below header

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">`);
  lines.push(`<style>text { font-family: 'DejaVu Sans', Arial, sans-serif; }</style>`);
  // clipPaths must be in <defs> before the elements that reference them
  lines.push(`<defs>
    <clipPath id="clipA"><circle cx="${AX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipB"><circle cx="${BX}" cy="${AY}" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Background
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${COLOR_BG}"/>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="${HEADER_H}" fill="${COLOR_HEADER}"/>`);
  lines.push(`<line x1="0" y1="${HEADER_H}" x2="${CARD_W}" y2="${HEADER_H}" stroke="${COLOR_BLURPLE}" stroke-width="2"/>`);
  lines.push(svgT(16, HEADER_H - 14, truncate(tournamentName.toUpperCase(), 28), COLOR_DIM, 11, 'bold'));
  const matchLabel = `ROUND ${round}  ·  MATCH ${position + 1}`;
  lines.push(svgT(CARD_W - 16, HEADER_H - 14, matchLabel, COLOR_BLURPLE, 11, 'bold', 'end'));

  // ── Avatars ───────────────────────────────────────────────────────────────
  renderAvatar(lines, AX, AY, avatarA, nameA, 'clipA');
  renderAvatar(lines, BX, AY, avatarB, nameB, 'clipB');

  // ── Names — large, bold, uppercase ───────────────────────────────────────
  const nameY = AY + AVATAR_R + 24;
  lines.push(svgT(AX, nameY, truncate(nameA, 10), COLOR_TEXT, 22, 'bold', 'middle'));
  lines.push(svgT(BX, nameY, truncate(nameB, 10), COLOR_TEXT, 22, 'bold', 'middle'));

  // Seed + rating on a single line below the name
  const statsY = nameY + 20;
  const statA = [
    participantA?.seed != null ? `SEED #${participantA.seed}` : null,
    formatRating(participantA?.rating ?? 1200, participantA?.matchesPlayed ?? 0) + ' ELO',
  ].filter(Boolean).join('  ·  ');
  const statB = [
    participantB?.seed != null ? `SEED #${participantB.seed}` : null,
    formatRating(participantB?.rating ?? 1200, participantB?.matchesPlayed ?? 0) + ' ELO',
  ].filter(Boolean).join('  ·  ');
  lines.push(svgT(AX, statsY, statA, COLOR_DIM, 10, 'normal', 'middle'));
  lines.push(svgT(BX, statsY, statB, COLOR_DIM, 10, 'normal', 'middle'));

  // ── VS. — perfectly centered ──────────────────────────────────────────────
  // Short horizontal rules on either side
  const vsY = AY;           // vertically aligned with avatar centers
  const ruleGap = 30;       // gap between rule end and VS text
  const ruleLen = AX + AVATAR_R + 10; // from avatar right edge inward toward center
  lines.push(`<line x1="${ruleLen}" y1="${vsY}" x2="${cx - ruleGap}" y2="${vsY}" stroke="${COLOR_SLOT}" stroke-width="1"/>`);
  lines.push(`<line x1="${cx + ruleGap}" y1="${vsY}" x2="${CARD_W - ruleLen}" y2="${vsY}" stroke="${COLOR_SLOT}" stroke-width="1"/>`);
  lines.push(svgT(cx, vsY + 14, 'VS.', COLOR_BLURPLE, 38, 'bold', 'middle'));

  // ── Scheduled time badge ──────────────────────────────────────────────────
  if (scheduledAt) {
    const timeStr = scheduledAt.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
    const badgeY = CARD_H - 16;
    const badgeW = 260;
    lines.push(`<rect x="${cx - badgeW / 2}" y="${badgeY - 16}" width="${badgeW}" height="22" rx="4" fill="${COLOR_SLOT}"/>`);
    lines.push(svgT(cx, badgeY, `🕐  ${timeStr}`, COLOR_DIM, 11, 'normal', 'middle'));
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

  const HEADER_H = 46;
  const cx = CARD_W / 2;
  const AX = Math.round(CARD_W * 0.175);
  const BX = CARD_W - AX;
  const AY = HEADER_H + AVATAR_R + 14;

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
  const nameY = AY + AVATAR_R + 24;
  lines.push(svgT(AX, nameY, truncate(winName, 10), COLOR_GREEN, 22, 'bold', 'middle'));
  if (loser) lines.push(svgT(BX, nameY, truncate(loseName, 10), COLOR_DIM, 20, 'normal', 'middle'));

  // ELO deltas
  const deltaStr = (d: number) => (d >= 0 ? `+${d}` : String(d));
  const eloY = nameY + 20;
  lines.push(svgT(AX, eloY,      `${deltaStr(eloChangeWinner)} ELO`, COLOR_GREEN, 11, 'bold', 'middle'));
  lines.push(svgT(AX, eloY + 14, 'WINNER', COLOR_GOLD, 9, 'bold', 'middle'));
  if (loser) {
    lines.push(svgT(BX, eloY,      `${deltaStr(eloChangeLoser)} ELO`, COLOR_DIM, 11, 'normal', 'middle'));
    lines.push(svgT(BX, eloY + 14, 'ELIMINATED', COLOR_DIM, 9, 'bold', 'middle'));
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
