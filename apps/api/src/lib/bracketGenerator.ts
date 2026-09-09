/**
 * Pure single-elimination bracket generator.
 *
 * Seeding follows the standard tournament convention:
 *   Round 1: #1 vs #N, #2 vs #(N-1), etc.
 * When N is odd, the middle seed (#ceil(N/2)) receives a BYE in round 1 and
 * the bracket continues with at most one BYE per round thereafter.  The
 * tournament is rejected at start time if countByeRounds(N) > 2.
 *
 * Returns a flat array of MatchSlot objects that can be fed directly to
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

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Count how many rounds would contain a BYE for a bracket of size N.
 * Each odd round contributes 1 BYE; the cascade shrinks via ceil(n/2).
 *
 * Examples: countByeRounds(8)=0, countByeRounds(9)=3, countByeRounds(10)=2,
 *           countByeRounds(11)=2, countByeRounds(12)=1.
 */
export function countByeRounds(n: number): number {
  let count = 0;
  while (n > 2) {
    if (n % 2 !== 0) count++;
    n = Math.ceil(n / 2);
  }
  return count;
}

/**
 * The smallest M ≥ n whose countByeRounds(M) ≤ 2.
 * If n itself is already satisfactory, returns n unchanged.
 */
export function nextSatisfactoryCount(n: number): number {
  let m = n;
  while (countByeRounds(m) > 2) m++;
  return m;
}

/** Returns the smallest power of 2 ≥ n.  Kept for external callers. */
export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Returns the largest power of 2 ≤ n. */
export function prevPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p * 2 <= n) p <<= 1;
  return p;
}

// ── Bracket generator ─────────────────────────────────────────────────────────

export function generateSingleElimBracket(
  tournamentId: string,
  participants: BracketParticipant[],
): MatchSlot[] {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const N = sorted.length;

  // Build the round structure by cascading ceil(incoming/2) until 1 slot left
  // (the grand final).  Each round records how many slots it has and whether
  // the last slot is a structural BYE (incoming was odd).
  const roundStructure: Array<{ slots: number; hasBye: boolean }> = [];
  let incoming = N;
  while (incoming > 1) {
    const hasBye = incoming % 2 !== 0;
    const slots = Math.ceil(incoming / 2);
    roundStructure.push({ slots, hasBye });
    incoming = slots;
  }
  const totalRounds = roundStructure.length;

  const matches: MatchSlot[] = [];

  for (let ri = 0; ri < roundStructure.length; ri++) {
    const r = ri + 1; // 1-indexed round number
    const { slots, hasBye } = roundStructure[ri]!;

    for (let pos = 0; pos < slots; pos++) {
      const key = `r${r}_p${pos}`;
      // nextMatchKey uses the same floor(pos/2) formula as a standard bracket.
      const nextKey = r < totalRounds ? `r${r + 1}_p${Math.floor(pos / 2)}` : null;

      const isByeSlot = hasBye && pos === slots - 1;

      let aId: string | null = null;
      let bId: string | null = null;
      let status = isByeSlot ? 'BYE' : 'PENDING';

      if (r === 1) {
        if (isByeSlot) {
          // The "middle" seed (ceil(N/2)) occupies the lone BYE slot.
          // It sits between the two bracket halves and auto-advances to round 2.
          aId = sorted[Math.floor(N / 2)]!.id;
          // bId remains null → status already set to 'BYE' above
        } else {
          // Standard symmetric seeding: position p pairs the p-th and (N-1-p)-th seeds.
          // This keeps the strongest and weakest opponents in the same match.
          aId = sorted[pos]!.id;
          bId = sorted[N - 1 - pos]!.id;
        }
      }
      // Rounds 2+: participantAId / participantBId are null at creation and are
      // filled in as previous rounds resolve.  Structural BYE slots (status='BYE')
      // are auto-advanced when their single feeder is resolved — see result
      // submission handler and the BYE auto-advance loop at bracket insert time.

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
        nextLoserMatchKey: null, // filled in below for semi-finals when applicable
      });
    }
  }

  // 3rd-place match: only when the semi-final round has two real (non-BYE) slots
  // so that both semi-final losers exist.  If the semi has a structural BYE, one
  // side has no loser and the 3rd-place match is skipped.
  const semiFinalHasBye = totalRounds >= 2
    ? (roundStructure[totalRounds - 2]?.hasBye ?? false)
    : true; // treat as "has bye" to skip 3rd place for tiny brackets

  if (totalRounds >= 2 && !semiFinalHasBye) {
    const THIRD_KEY = 'tp_p0';
    matches.push({
      key: THIRD_KEY,
      tournamentId,
      round: totalRounds,   // same round number as the Grand Final
      position: 0,
      bracketSide: 'THIRD_PLACE',
      participantAId: null,
      participantBId: null,
      status: 'PENDING',
      nextMatchKey: null,
      nextLoserMatchKey: null,
    });

    // Wire every semi-final match's loser into the 3rd-place match
    const semiFinalRound = totalRounds - 1;
    for (const m of matches) {
      if (m.round === semiFinalRound && m.bracketSide === 'WINNERS') {
        m.nextLoserMatchKey = THIRD_KEY;
      }
    }
  }

  return matches;
}

// ── resolveNextMatchIds ───────────────────────────────────────────────────────

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
