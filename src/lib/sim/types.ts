/** Core types for the Lexigotchi off-chain economy simulation (spec v0.2). */
import type { Tier } from "../economy";

export type HungerState = "fed" | "peckish" | "hungry";
export type WordCase = "lowercase" | "Mixed" | "UPPERCASE";

/** A claimed Word NFT held by a player. Case is DERIVED from escrowed letters (v0.2 §2). */
export interface ClaimedWord {
  word: string;
  tier: Tier;
  /** Per-position case of the 5 escrowed letters (true = uppercase). Case is computed from this. */
  upper: [boolean, boolean, boolean, boolean, boolean];
  staked: boolean;
  /** Consecutive days the staked word has gone unfed (0 = fed today). */
  daysUnfed: number;
  /** Set during a turn when the word is fed; consumed by the post-turn hunger tick. */
  fedToday: boolean;
}

export function wordCase(w: ClaimedWord): WordCase {
  const n = w.upper.filter(Boolean).length;
  if (n === 0) return "lowercase";
  if (n === 5) return "UPPERCASE";
  return "Mixed";
}

export type Archetype = "casual" | "collector" | "gambler" | "staker" | "whale";

export interface Player {
  id: number;
  archetype: Archetype;
  hasFID: boolean;
  active: boolean;
  /** $WORD spendable balance. */
  balance: number;
  /** Inventory of loose (un-escrowed) letters: lower[0..25] = a..z, upper[0..25] = A..Z counts. */
  lower: number[];
  upper: number[];
  /** Claimed words owned, keyed by word. */
  words: Map<string, ClaimedWord>;
  /** Pity streak per lowercase letter index (the (owner,letterId) rule, v0.2 §5.2). */
  pity: number[];
  /** Whether the player took their FID daily mint today. */
  mintedDailyToday: boolean;
  /** Whether the free daily check-in snack has been used today. */
  freeSnackUsedToday: boolean;
  /** Lifetime accounting for ROI metrics. */
  spent: number;
  earned: number;
  /** Portion of `earned` that came specifically from selling letters on the swap market
   *  (isolated so recoup can be read cleanly, separate from lumpy yield/jackpot winnings). */
  tradeEarned: number;
  /** Day index the player most recently took any action (for retention metrics). */
  lastActiveDay: number;
  joinedDay: number;
}

export interface DayMetrics {
  day: number;
  pool: number;
  jackpot: number;
  burnedTotal: number;
  treasuryTotal: number;
  externalInflowTotal: number;
  poolInflowToday: number;
  poolOutflowToday: number;
  jackpotPaidToday: number;
  jackpotRolledOver: boolean;
  distributionToday: number;
  totalClaims: number;
  uniqueClaimers: number;
  stakedWords: number;
  uppercaseWords: number;
  yieldEligibleWords: number;
  activePlayers: number;
  lettersMintedTotal: number;
  /** Fraction of each letter's global cap consumed (mint-out pressure). */
  capConsumption: Record<string, number>;
  /** Gross claims ever made (monotonic; counts re-claims after dissolution) — claim velocity. */
  claimsEverTotal: number;
  /** Words dissolved cumulatively (names returned to the claimable pool). */
  dissolutionsTotal: number;
  /** Letters cleared on the secondary swap market (today / cumulative). */
  lettersTradedToday: number;
  lettersTradedTotal: number;
  /** Secondary GMV in USD cleared today (letters × floor). */
  tradeVolumeUsdToday: number;
}

export interface SimResult {
  days: DayMetrics[];
  final: DayMetrics;
  /** Per-archetype ROI + participation summary (viability + accessibility). */
  playerRoi: {
    archetype: Archetype;
    spent: number;
    earned: number;
    /** Of `earned`, the part from selling letters on the swap market (clean recoup signal). */
    recoup: number;
    net: number;
    claims: number;
    players: number;
  }[];
  /** Notable invariant / health findings surfaced during the run. */
  notes: string[];
  /** Equilibrium estimate for the Rewards Pool given observed pool inflow. */
  poolEquilibrium: number;
  jackpotWins: { day: number; word: string; amount: number }[];
}
