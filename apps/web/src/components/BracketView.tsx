import React, { useMemo } from 'react';
import type { TournamentMatch, TournamentParticipant } from '../api/tournament';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// ── Layout constants (match bracketSvg.ts for visual consistency) ─────────────

const SLOT_W = 180;
const SLOT_H = 36;
const SLOT_R = 6;
const COL_GAP = 80;
const ROW_GAP = 16;
const PAD = 32;
const TITLE_H = 40;

const COLOR_BG        = '#1e1f22';
const COLOR_SLOT      = '#2b2d31';
const COLOR_SLOT_WIN  = '#2b3d2e';
const COLOR_TEXT      = '#dbdee1';
const COLOR_DIM       = '#72767d';
const COLOR_LINE      = '#404249';
const COLOR_WIN       = '#57f287';
const COLOR_ACTIVE    = '#5865f2';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BracketViewProps {
  matches: TournamentMatch[];
  participants: TournamentParticipant[];
  tournamentName: string;
  /** Called when a manager clicks a pending/scheduled match to submit a result */
  onSubmitResult?: (match: TournamentMatch) => void;
  isManager?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BracketView({ matches, participants, tournamentName, onSubmitResult, isManager }: BracketViewProps) {
  const byId = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const winners = useMemo(
    () => matches.filter((m) => m.bracketSide === 'WINNERS'),
    [matches],
  );

  const maxRound = useMemo(
    () => Math.max(0, ...winners.map((m) => m.round)),
    [winners],
  );

  const slotsPerRound = useMemo(() => {
    const out: number[] = [];
    for (let r = 1; r <= maxRound; r++) {
      out.push(winners.filter((m) => m.round === r).length);
    }
    return out;
  }, [winners, maxRound]);

  const maxSlots = slotsPerRound[0] ?? 1;
  const slotPairH = SLOT_H * 2 + ROW_GAP;
  const bracketH = maxSlots * slotPairH + (maxSlots - 1) * ROW_GAP;
  const svgW = PAD * 2 + maxRound * SLOT_W + (maxRound - 1) * COL_GAP;
  const svgH = PAD * 2 + bracketH + TITLE_H;

  const connectors: React.ReactElement[] = [];
  const slots: React.ReactElement[] = [];

  for (let r = 1; r <= maxRound; r++) {
    const colMatches = winners
      .filter((m) => m.round === r)
      .sort((a, b) => a.position - b.position);
    const nMatches = colMatches.length;
    const cellH = bracketH / nMatches;
    const x = PAD + (r - 1) * (SLOT_W + COL_GAP);

    colMatches.forEach((match, mi) => {
      const pA = match.participantAId ? byId.get(match.participantAId) : null;
      const pB = match.participantBId ? byId.get(match.participantBId) : null;
      const isComplete = match.status === 'COMPLETED' || match.status === 'BYE';
      const isCurrent = match.status === 'SCHEDULED' || match.status === 'IN_PROGRESS' || match.status === 'READY_CHECK';
      const canSubmit = isManager && !isComplete && pA && pB;

      const matchTopY = PAD + TITLE_H + mi * cellH + (cellH - slotPairH) / 2;
      const yA = matchTopY;
      const yB = matchTopY + SLOT_H + ROW_GAP;

      const wonA = match.winnerId && match.winnerId === match.participantAId;
      const wonB = match.winnerId && match.winnerId === match.participantBId;

      // Slot A
      slots.push(
        <MatchSlot
          key={`${match.id}-A`}
          x={x} y={yA}
          participant={pA ?? null}
          isWinner={!!wonA}
          isComplete={isComplete}
          isCurrent={isCurrent}
          score={match.scoreA}
        />,
      );
      // Slot B
      slots.push(
        <MatchSlot
          key={`${match.id}-B`}
          x={x} y={yB}
          participant={pB ?? null}
          isWinner={!!wonB}
          isComplete={isComplete}
          isCurrent={isCurrent}
          score={match.scoreB}
        />,
      );

      // Manager result entry overlay
      if (canSubmit) {
        slots.push(
          <foreignObject
            key={`${match.id}-btn`}
            x={x + SLOT_W - 60}
            y={matchTopY + slotPairH / 2 - 12}
            width={56}
            height={24}
          >
            <button
              // @ts-expect-error xmlns required for SVG foreignObject
              xmlns="http://www.w3.org/1999/xhtml"
              onClick={() => onSubmitResult?.(match)}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded"
            >
              Result
            </button>
          </foreignObject>,
        );
      }

      // Completion tooltip overlay
      if (isComplete && match.winnerId) {
        const winner = byId.get(match.winnerId);
        const scoreText = match.scoreA != null ? ` (${match.scoreA}–${match.scoreB})` : '';
        slots.push(
          <Tooltip key={`${match.id}-tip`}>
            <TooltipTrigger asChild>
              <rect
                x={x} y={matchTopY}
                width={SLOT_W} height={slotPairH}
                fill="transparent" className="cursor-help"
              />
            </TooltipTrigger>
            <TooltipContent>
              <span>Winner: {winner?.displayName ?? '?'}{scoreText}</span>
            </TooltipContent>
          </Tooltip>,
        );
      }

      // Connector lines to next round
      if (r < maxRound) {
        const xRight = x + SLOT_W;
        const midY = matchTopY + SLOT_H + ROW_GAP / 2;
        const nextNMatches = slotsPerRound[r] ?? 1;
        const nextCellH = bracketH / nextNMatches;
        const nextMi = Math.floor(mi / 2);
        const nextMatchTopY = PAD + TITLE_H + nextMi * nextCellH + (nextCellH - slotPairH) / 2;
        const targetY = mi % 2 === 0
          ? nextMatchTopY + SLOT_H / 2
          : nextMatchTopY + SLOT_H + ROW_GAP + SLOT_H / 2;

        connectors.push(
          <React.Fragment key={`conn-${match.id}`}>
            <line x1={xRight} y1={midY} x2={xRight + COL_GAP / 2} y2={midY} stroke={COLOR_LINE} strokeWidth={1.5} />
            <line x1={xRight + COL_GAP / 2} y1={midY} x2={xRight + COL_GAP / 2} y2={targetY} stroke={COLOR_LINE} strokeWidth={1.5} />
            <line x1={xRight + COL_GAP / 2} y1={targetY} x2={xRight + COL_GAP} y2={targetY} stroke={COLOR_LINE} strokeWidth={1.5} />
          </React.Fragment>,
        );
      }
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg">
      <svg
        width={svgW}
        height={svgH}
        style={{ background: COLOR_BG, minWidth: svgW }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <text x={PAD} y={PAD + 20} fill={COLOR_TEXT} fontSize={14} fontWeight="bold">
          {tournamentName}
        </text>
        {connectors}
        {slots}
      </svg>
    </div>
  );
}

// ── Participant slot ──────────────────────────────────────────────────────────

interface MatchSlotProps {
  x: number; y: number;
  participant: TournamentParticipant | null | undefined;
  isWinner: boolean;
  isComplete: boolean;
  isCurrent: boolean;
  score: number | null | undefined;
}

function MatchSlot({ x, y, participant, isWinner, isComplete, isCurrent, score }: MatchSlotProps) {
  const borderColor = isWinner ? COLOR_WIN : isCurrent ? COLOR_ACTIVE : COLOR_LINE;
  const fillColor = isWinner ? COLOR_SLOT_WIN : COLOR_SLOT;
  const textColor = !participant ? COLOR_DIM : isComplete && !isWinner ? COLOR_DIM : COLOR_TEXT;
  const label = participant ? truncate(participant.displayName, 18) : 'TBD';

  return (
    <g>
      <rect
        x={x} y={y}
        width={SLOT_W} height={SLOT_H}
        rx={SLOT_R} ry={SLOT_R}
        fill={fillColor} stroke={borderColor} strokeWidth={1.5}
      />
      <text x={x + 8} y={y + SLOT_H / 2 + 5} fill={textColor} fontSize={12}>
        {label}
      </text>
      {participant?.seed != null && (
        <text x={x + SLOT_W - 28} y={y + SLOT_H / 2 + 5} fill={COLOR_DIM} fontSize={10}>
          #{participant.seed}
        </text>
      )}
      {score != null && (
        <text x={x + SLOT_W - 48} y={y + SLOT_H / 2 + 5} fill={textColor} fontSize={11} fontWeight="bold">
          {score}
        </text>
      )}
    </g>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
