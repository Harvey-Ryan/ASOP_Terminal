import { Resvg } from '@resvg/resvg-js';

// ── resvg-js wrapper ──────────────────────────────────────────────────────────

export function svgToPng(svg: string, widthPx = 1200): Buffer {
  const resvg = new Resvg(svg, {
    background: '#1e1f22',
    fitTo: { mode: 'width', value: widthPx },
    font: {
      loadSystemFonts: true,
      // Noto Sans is installed via `apk add font-noto` in the Dockerfile.
      // On local dev, resvg falls back to whatever sans-serif is available.
      defaultFontFamily: 'Noto Sans',
      sansSerifFamily: 'Noto Sans',
    },
  });
  return Buffer.from(resvg.render().asPng());
}

// ── Layout constants ──────────────────────────────────────────────────────────

const SLOT_W = 180;
const SLOT_H = 36;
const SLOT_R = 6;
const COL_GAP = 80;  // horizontal gap between rounds
const ROW_GAP = 16;  // vertical gap between slots within a column
const PAD = 32;      // outer padding

const COLOR_BG        = '#1e1f22';
const COLOR_SLOT      = '#2b2d31';
const COLOR_SLOT_WIN  = '#2b3d2e'; // winner slot fill
const COLOR_TEXT      = '#dbdee1';
const COLOR_DIMMED    = '#72767d';
const COLOR_LINE      = '#404249';
const COLOR_WIN_BORDER = '#57f287'; // Discord green
const COLOR_ACTIVE    = '#5865f2'; // Discord blurple

// ── Types mirroring Prisma shapes (no prisma import needed in this lib) ───────

export interface BracketParticipantInfo {
  id: string;
  displayName: string;
  seed: number | null;
}

export interface BracketMatchInfo {
  id: string;
  round: number;
  position: number;
  bracketSide: string;
  participantAId: string | null;
  participantBId: string | null;
  winnerId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
}

// ── Bracket SVG builder ───────────────────────────────────────────────────────

export function buildBracketSvg(
  tournamentName: string,
  matches: BracketMatchInfo[],
  participants: BracketParticipantInfo[],
): string {
  const byId = new Map(participants.map((p) => [p.id, p]));

  const winners = matches.filter((m) => m.bracketSide === 'WINNERS');
  const maxRound = Math.max(0, ...winners.map((m) => m.round));

  // How many slots per round (for vertical spacing)
  const slotsPerRound: number[] = [];
  for (let r = 1; r <= maxRound; r++) {
    slotsPerRound.push(winners.filter((m) => m.round === r).length);
  }

  // Canvas size
  const totalCols = maxRound;
  const maxSlots = slotsPerRound[0] ?? 1;
  const slotPairH = SLOT_H * 2 + ROW_GAP; // height of one match (two participant slots)
  const bracketH = maxSlots * slotPairH + (maxSlots - 1) * ROW_GAP;
  const svgW = PAD * 2 + totalCols * SLOT_W + (totalCols - 1) * COL_GAP;
  const svgH = PAD * 2 + bracketH + 40; // +40 for title

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="background:${COLOR_BG}">`);
  lines.push(`<style>text{font-family:'Noto Sans','Arial',sans-serif;}</style>`);

  // Title
  lines.push(svgText(PAD, 24, tournamentName, COLOR_TEXT, 14, 'bold'));

  // Draw connector lines then slots (so lines are below slots)
  const connectors: string[] = [];
  const slots: string[] = [];

  for (let r = 1; r <= maxRound; r++) {
    const colMatches = winners.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
    const nMatches = colMatches.length;
    const cellH = bracketH / nMatches;
    const x = PAD + (r - 1) * (SLOT_W + COL_GAP);

    colMatches.forEach((match, mi) => {
      const pA = match.participantAId ? byId.get(match.participantAId) : null;
      const pB = match.participantBId ? byId.get(match.participantBId) : null;
      const isComplete = match.status === 'COMPLETED' || match.status === 'BYE';
      const isCurrent = match.status === 'SCHEDULED' || match.status === 'IN_PROGRESS' || match.status === 'READY_CHECK';

      // Vertical center of this match in the column
      const matchTopY = PAD + 40 + mi * cellH + (cellH - slotPairH) / 2;

      // Slot A
      const yA = matchTopY;
      const yB = matchTopY + SLOT_H + ROW_GAP;

      const wonA = match.winnerId === match.participantAId;
      const wonB = match.winnerId === match.participantBId;

      renderParticipantSlot(slots, x, yA, pA, wonA, isComplete, isCurrent, match.scoreA);
      renderParticipantSlot(slots, x, yB, pB, wonB, isComplete, isCurrent, match.scoreB);

      // Connector to next round
      if (r < maxRound) {
        const xRight = x + SLOT_W;
        const midY = matchTopY + SLOT_H + ROW_GAP / 2; // horizontal midpoint line
        const nextX = x + SLOT_W + COL_GAP;
        const nextNMatches = slotsPerRound[r] ?? 1;
        const nextCellH = bracketH / nextNMatches;
        const nextMi = Math.floor(mi / 2);
        const nextMatchTopY = PAD + 40 + nextMi * nextCellH + (nextCellH - slotPairH) / 2;
        const targetY = mi % 2 === 0
          ? nextMatchTopY + SLOT_H / 2       // top slot of next pair
          : nextMatchTopY + SLOT_H + ROW_GAP + SLOT_H / 2; // bottom slot

        connectors.push(svgLine(xRight, midY, xRight + COL_GAP / 2, midY, COLOR_LINE));
        connectors.push(svgLine(xRight + COL_GAP / 2, midY, xRight + COL_GAP / 2, targetY, COLOR_LINE));
        connectors.push(svgLine(xRight + COL_GAP / 2, targetY, nextX, targetY, COLOR_LINE));
      }
    });
  }

  lines.push(...connectors, ...slots);
  lines.push('</svg>');
  return lines.join('\n');
}

// ── Participant slot renderer ─────────────────────────────────────────────────

function renderParticipantSlot(
  out: string[],
  x: number, y: number,
  participant: BracketParticipantInfo | null | undefined,
  isWinner: boolean,
  isComplete: boolean,
  isCurrent: boolean,
  score: number | null | undefined,
): void {
  const borderColor = isWinner ? COLOR_WIN_BORDER : isCurrent ? COLOR_ACTIVE : COLOR_LINE;
  const fillColor = isWinner ? COLOR_SLOT_WIN : COLOR_SLOT;
  const textColor = !participant ? COLOR_DIMMED : (isComplete && !isWinner) ? COLOR_DIMMED : COLOR_TEXT;

  out.push(svgRect(x, y, SLOT_W, SLOT_H, SLOT_R, fillColor, borderColor));

  const label = participant ? truncate(participant.displayName, 18) : 'TBD';
  out.push(svgText(x + 8, y + SLOT_H / 2 + 5, label, textColor, 12));

  if (participant?.seed != null) {
    out.push(svgText(x + SLOT_W - 28, y + SLOT_H / 2 + 5, `#${participant.seed}`, COLOR_DIMMED, 10));
  }

  if (score != null) {
    out.push(svgText(x + SLOT_W - 48, y + SLOT_H / 2 + 5, String(score), textColor, 11, 'bold'));
  }
}

// ── SVG primitive helpers ─────────────────────────────────────────────────────

function svgRect(x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

function svgText(x: number, y: number, text: string, fill: string, size: number, weight = 'normal'): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${escaped}</text>`;
}

function svgLine(x1: number, y1: number, x2: number, y2: number, stroke: string): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.5"/>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
