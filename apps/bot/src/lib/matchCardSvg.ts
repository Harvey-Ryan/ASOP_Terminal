import { svgToPng } from './bracketSvg.js';

// ── Layout ────────────────────────────────────────────────────────────────────

const CARD_W = 800;
const CARD_H = 280;
const COLOR_BG      = '#1e1f22';
const COLOR_SLOT    = '#2b2d31';
const COLOR_TEXT    = '#dbdee1';
const COLOR_DIM     = '#72767d';
const COLOR_GREEN   = '#57f287';
const COLOR_BLURPLE = '#5865f2';
const AVATAR_R      = 36; // circle radius

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
  return `hsl(${hue},60%,45%)`;
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

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" style="background:${COLOR_BG}">`);
  lines.push(`<defs>
    <clipPath id="clipA"><circle cx="96" cy="140" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipB"><circle cx="${CARD_W - 96}" cy="140" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Header bar
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="48" fill="${COLOR_SLOT}"/>`);
  const header = `${tournamentName}  ·  Round ${round}  ·  Match ${position + 1}`;
  lines.push(svgText(20, 30, header, COLOR_DIM, 13));

  // "⚔️ VS" center
  lines.push(svgText(CARD_W / 2, 150, 'VS', COLOR_BLURPLE, 28, 'bold', 'middle'));

  // ── Participant A (left) ──────────────────────────────────────────────────
  renderAvatarCircle(lines, 96, 140, avatarA, participantA?.displayName ?? 'TBD', 'clipA');
  lines.push(svgText(96, 200, truncate(participantA?.displayName ?? 'TBD', 14), COLOR_TEXT, 14, 'bold', 'middle'));
  if (participantA?.seed != null) lines.push(svgText(96, 220, `#${participantA.seed} seed`, COLOR_DIM, 11, 'normal', 'middle'));
  const ratingA = formatRating(participantA?.rating ?? 1200, participantA?.matchesPlayed ?? 0);
  lines.push(svgText(96, 238, ratingA, COLOR_DIM, 11, 'normal', 'middle'));

  // ── Participant B (right) ─────────────────────────────────────────────────
  const bx = CARD_W - 96;
  renderAvatarCircle(lines, bx, 140, avatarB, participantB?.displayName ?? 'TBD', 'clipB');
  lines.push(svgText(bx, 200, truncate(participantB?.displayName ?? 'TBD', 14), COLOR_TEXT, 14, 'bold', 'middle'));
  if (participantB?.seed != null) lines.push(svgText(bx, 220, `#${participantB.seed} seed`, COLOR_DIM, 11, 'normal', 'middle'));
  const ratingB = formatRating(participantB?.rating ?? 1200, participantB?.matchesPlayed ?? 0);
  lines.push(svgText(bx, 238, ratingB, COLOR_DIM, 11, 'normal', 'middle'));

  // Scheduled time
  if (scheduledAt) {
    const timeStr = scheduledAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    lines.push(svgText(CARD_W / 2, 268, `🕐 ${timeStr}`, COLOR_DIM, 11, 'normal', 'middle'));
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

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" style="background:${COLOR_BG}">`);
  lines.push(`<defs>
    <clipPath id="clipW"><circle cx="96" cy="140" r="${AVATAR_R}"/></clipPath>
    <clipPath id="clipL"><circle cx="${CARD_W - 96}" cy="140" r="${AVATAR_R}"/></clipPath>
  </defs>`);

  // Header
  lines.push(`<rect x="0" y="0" width="${CARD_W}" height="48" fill="${COLOR_SLOT}"/>`);
  lines.push(svgText(20, 30, `${tournamentName}  ·  Round ${round} Result`, COLOR_DIM, 13));

  // Score banner
  if (scoreA != null && scoreB != null) {
    const scoreStr = `${scoreA} – ${scoreB}`;
    lines.push(svgText(CARD_W / 2, 152, scoreStr, COLOR_TEXT, 22, 'bold', 'middle'));
  } else {
    lines.push(svgText(CARD_W / 2, 152, '✓', COLOR_GREEN, 28, 'bold', 'middle'));
  }

  // Unused match position for context
  lines.push(svgText(CARD_W / 2, 175, `Match ${position + 1}`, COLOR_DIM, 11, 'normal', 'middle'));

  // Winner side (highlighted green)
  renderAvatarCircle(lines, 96, 140, winAvatar, winner.displayName, 'clipW', COLOR_GREEN);
  lines.push(svgText(96, 200, truncate(winner.displayName, 14), COLOR_GREEN, 14, 'bold', 'middle'));
  const winDelta = eloChangeWinner >= 0 ? `+${eloChangeWinner} 🔺` : `${eloChangeWinner} 🔻`;
  lines.push(svgText(96, 220, winDelta, COLOR_GREEN, 12, 'bold', 'middle'));
  lines.push(svgText(96, 238, '🏆 Winner', COLOR_GREEN, 11, 'normal', 'middle'));

  // Loser side (dimmed)
  const lx = CARD_W - 96;
  if (loser) {
    renderAvatarCircle(lines, lx, 140, loseAvatar, loser.displayName, 'clipL');
    lines.push(svgText(lx, 200, truncate(loser.displayName, 14), COLOR_DIM, 14, 'normal', 'middle'));
    const loseDelta = eloChangeLoser >= 0 ? `+${eloChangeLoser}` : String(eloChangeLoser);
    lines.push(svgText(lx, 220, `${loseDelta} 🔻`, COLOR_DIM, 12, 'normal', 'middle'));
    lines.push(svgText(lx, 238, 'Eliminated', COLOR_DIM, 11, 'normal', 'middle'));
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ── helpers ───────────────────────────────────────────────────────────────────

function renderAvatarCircle(
  out: string[],
  cx: number, cy: number,
  avatarDataUri: string | null,
  name: string,
  clipId: string,
  borderColor = '#404249',
): void {
  const r = AVATAR_R;
  if (avatarDataUri) {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${borderColor}" stroke-width="2"/>`);
    out.push(`<image href="${avatarDataUri}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${clipId})"/>`);
  } else {
    // Fallback: colored circle with initial
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${nameColor(name)}" stroke="${borderColor}" stroke-width="2"/>`);
    const initial = name[0]?.toUpperCase() ?? '?';
    out.push(svgText(cx, cy + 6, initial, '#fff', 20, 'bold', 'middle'));
  }
}

function svgText(x: number, y: number, text: string, fill: string, size: number, weight = 'normal', anchor = 'start'): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="'DejaVu Sans',Arial,sans-serif">${escaped}</text>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatRating(rating: number, matchesPlayed: number): string {
  return matchesPlayed < 10 ? `~${rating}` : String(rating);
}
