/**
 * How a released set went (the admin's Sets tab): pure, from the claims the chain recorded.
 */
export interface SetClaim {
  word: string;
  /** The wallet that claimed it, lowercase. */
  owner: string;
  /** The chain's clock at the claim, in seconds. */
  at: number;
}

export interface SetStats {
  total: number;
  /** Words of the set somebody owns right now. Null: couldn't be read. */
  claimedNow: number | null;
  /** Seconds from the release to the first claim. Null: none yet. */
  firstClaimSeconds: number | null;
  /** Wallets that claimed at least one of the set's words. */
  uniqueClaimers: number;
  /** Claims made while the first-day gate was up, and after it (or with no gate). */
  duringGate: number;
  afterGate: number;
}

export function setStats(
  set: { words: readonly string[]; releasedAtSec: number; gateUntilSec: number | null },
  claims: readonly SetClaim[],
  ownedNow: readonly string[] | null,
): SetStats {
  const mine = new Set(set.words);
  const rows = claims.filter((c) => mine.has(c.word) && c.at >= set.releasedAtSec).sort((a, b) => a.at - b.at);
  const gated = (c: SetClaim) => set.gateUntilSec !== null && c.at < set.gateUntilSec;
  return {
    total: set.words.length,
    claimedNow: ownedNow === null ? null : ownedNow.filter((w) => mine.has(w)).length,
    firstClaimSeconds: rows[0] ? rows[0].at - set.releasedAtSec : null,
    uniqueClaimers: new Set(rows.map((c) => c.owner)).size,
    duringGate: rows.filter(gated).length,
    afterGate: rows.filter((c) => !gated(c)).length,
  };
}
