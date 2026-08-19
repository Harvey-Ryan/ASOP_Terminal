/**
 * Pure single-elimination bracket generator.
 *
 * Seeding follows the standard tournament convention:
 *   Round 1: #1 vs #N, #2 vs #(N-1), etc.
 * Participants are padded with BYE slots (null discordId, status "BYE") to the
 * next power of 2 before slot assignment.
 *
 * Returns a flat array of MatchCreateInput objects that can be fed directly to
 *   prisma.tournamentMatch.createMany({ data: matches })
 * after the participant rows exist.
 */

export interface BracketParticipant {
  id: string;
  seed: number;
}

export interface MatchSlot {
  /** temporary client-side key used to wire nextMatchId links before DB insert */
  key: string;
  tournamentId: string;
  round: number;
  position: number;
  bracketSide: 'WINNERS' | 'LOSERS' | 'GRAND_FINALS' | 'THIRD_PLACE';
  participantAId: string | null;
  participantBId: string | null;
  status: string;
  /** key of the match where the winner of this match advances */
  nextMatchKey: string | null;
  /** key of the match where the loser of this match advances (3rd place) */
  nextLoserMatchKey: string | null;
}

export function generateSingleElimBracket(
  tournamentId: string,
  participants: BracketParticipant[],
): MatchSlot[] {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const bracketSize = nextPow2(sorted.length);
  const seeded: Array<BracketParticipant | null | undefined> = Array(bracketSize).fill(null);

  // Assign seeds into slots using the standard bracket pairing pattern.
  // Slot 0 = #1 seed, slot 1 = #bracketSize seed, slot 2 = #2 seed, …
  const slotOrder = buildSlotOrder(bracketSize);
  for (let i = 0; i < sorted.length; i++) {
    const slot = slotOrder[i] as number;
    seeded[slot] = sorted[i];
  }

  const matches: MatchSlot[] = [];
  const rounds = Math.log2(bracketSize);

  // Build round-by-round, storing provisional keys so we can link nextMatchKey.
  for (let r = 1; r <= rounds; r++) {
    const matchesInRound = bracketSize / Math.pow(2, r);
    for (let pos = 0; pos < matchesInRound; pos++) {
      const key = `r${r}_p${pos}`;
      const nextKey = r < rounds ? `r${r + 1}_p${Math.floor(pos / 2)}` : null;

      let aId: string | null = null;
      let bId: string | null = null;
      let status = 'PENDING';

      if (r === 1) {
        const slotA = pos * 2;
        const slotB = pos * 2 + 1;
        aId = seeded[slotA]?.id ?? null;
        bId = seeded[slotB]?.id ?? null;
        if (!aId || !bId) {
          // Normalize: the lone participant always lives in slot A so the BYE
          // advance loop can unconditionally use participantAId.
          if (!aId && bId) { aId = bId; bId = null; }
          status = 'BYE';
        }
      }
      // Round 2+ start with no participants; they're filled when prior matches resolve.

      matches.push({
        key,
        tournamentId,
        round: r,
        position: pos,
        bracketSide: 'WINNERS',
        participantAId: aId,
        participantBId: bId,
        status,
        nextMatchKey: nextKey,
        nextLoserMatchKey: null, // filled in below for semifinal round
      });
    }
  }

  // Generate 3rd-place match when there are at least 2 rounds (i.e. 4+ participants).
  // The semifinal round is (rounds - 1); both losers advance to the 3rd-place match.
  if (rounds >= 2) {
    const THIRD_KEY = 'tp_p0';
    matches.push({
      key: THIRD_KEY,
      tournamentId,
      round: rounds,         // same round as the Grand Final
      position: 0,
      bracketSide: 'THIRD_PLACE',
      participantAId: null,  // filled when semifinal losers are known
      participantBId: null,
      status: 'PENDING',
      nextMatchKey: null,
      nextLoserMatchKey: null,
    });

    // Wire every semifinal match (round = rounds - 1) to feed losers here
    const semiFinalRound = rounds - 1;
    for (const m of matches) {
      if (m.round === semiFinalRound && m.bracketSide === 'WINNERS') {
        m.nextLoserMatchKey = THIRD_KEY;
      }
    }
  }

  return matches;
}

/**
 * Resolves provisional `nextMatchKey` strings to actual DB ids.
 * Call this after `createMany` returns the inserted rows with their real ids,
 * then batch-update `nextMatchId` on each match.
 *
 * @param slots  Original slot array (with keys)
 * @param dbIds  Map of key → database id (cuid) from the insert result
 * @returns      Array of { id, nextMatchId } update payloads
 */
export function resolveNextMatchIds(
  slots: MatchSlot[],
  dbIds: Map<string, string>,
): Array<{ id: string; nextMatchId: string | null; nextLoserMatchId: string | null }> {
  return slots.map((slot) => ({
    id: dbIds.get(slot.key)!,
    nextMatchId: slot.nextMatchKey ? (dbIds.get(slot.nextMatchKey) ?? null) : null,
    nextLoserMatchId: slot.nextLoserMatchKey ? (dbIds.get(slot.nextLoserMatchKey) ?? null) : null,
  }));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Builds the slot-assignment order for standard bracket seeding.
 * e.g. for size=8: slots receive seeds [1, 8, 5, 4, 3, 6, 7, 2]
 * producing matchups: 1v8, 5v4, 3v6, 7v2 in round 1.
 */
function buildSlotOrder(size: number): number[] {
  let order = [0, 1];
  while (order.length < size) {
    const next: number[] = [];
    const len = order.length * 2;
    for (const slot of order) {
      next.push(slot, len - 1 - slot);
    }
    order = next;
  }
  return order;
}
