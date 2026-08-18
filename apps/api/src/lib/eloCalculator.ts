const K_PROVISIONAL = 32; // first 10 matches
const K_ESTABLISHED = 16; // 10+ matches
const RATING_FLOOR = 100;

export interface EloResult {
  deltaA: number;
  deltaB: number;
  newA: number;
  newB: number;
}

/**
 * Pure ELO calculation — no DB access.
 *
 * K-factor: 32 for provisional players (< 10 matches), 16 for established.
 * Rating floor: 100 (no player can fall below this).
 */
export function calcElo(
  ratingA: number,
  matchesA: number,
  ratingB: number,
  matchesB: number,
  aWon: boolean,
): EloResult {
  const kA = matchesA < 10 ? K_PROVISIONAL : K_ESTABLISHED;
  const kB = matchesB < 10 ? K_PROVISIONAL : K_ESTABLISHED;

  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const scoreA = aWon ? 1 : 0;

  const deltaA = Math.round(kA * (scoreA - expectedA));
  const deltaB = Math.round(kB * (1 - scoreA - (1 - expectedA)));

  return {
    deltaA,
    deltaB,
    newA: Math.max(RATING_FLOOR, ratingA + deltaA),
    newB: Math.max(RATING_FLOOR, ratingB + deltaB),
  };
}

export function isProvisional(matchesPlayed: number): boolean {
  return matchesPlayed < 10;
}

export function formatRating(rating: number, matchesPlayed: number): string {
  return isProvisional(matchesPlayed) ? `~${rating}` : String(rating);
}
