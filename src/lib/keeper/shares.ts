import { DEFAULT_PARAMS, type Params } from "@/lib/params";
import { TIER_WEIGHT, type Tier } from "@/lib/economy";

/**
 * The tier a word is WEIGHED at. Always passed in, never read here: a collab word is Legendary
 * from its set's reveal (lib/rarity.ts `tierFn`), and the caller that pays must have read the
 * collab words for certain (lib/keeper/jobs.ts refuses to open an epoch otherwise). The simulator
 * and a test with no sets pass `wordTier`, the derived tier.
 */
export type TierOf = (word: string) => Tier;

/**
 * The keeper's share math — the off-chain half of MerkleEpochs.
 *
 * YieldDistributor and Bounty trust the keeper for FAIRNESS only (solvency is enforced on-chain by
 * pull-at-open), and fairness means: this file computes exactly what the contracts' NatSpec and the
 * sim promise, from the same params, and nothing else. Everything here is pure and deterministic —
 * same words, same pot, same leaves, byte for byte — because an epoch's tree is published and every
 * proof served from it must be reproducible.
 *
 * Amounts are WEI (bigint). Weights are floats (they mirror the sim) scaled to integer millionths
 * before the split so the bigint arithmetic is exact; floor division leaves dust in the epoch,
 * which the claim window's recoverUnclaimed eventually sweeps — never overpayment, which would
 * brick the epoch's last claims against the Underfunded check.
 */

export interface KeeperWord {
  tokenId: bigint;
  /** UPPERCASE dictionary key. */
  word: string;
  /** Beneficial owner — the staker for staked words, else the holder. Claims pay this address. */
  owner: `0x${string}`;
  staked: boolean;
  daysUnfed: number;
  /**
   * Seconds since the last feed — the SAME quantity as `daysUnfed`, unfloored.
   *
   * The share math deliberately uses whole days, because that is what the contracts and the sim
   * count. Notifications can't: "your words go hungry in 6h" needs the remainder that flooring
   * throws away, and rounding it back up to a day would make us either cry wolf or warn too late.
   * Derived from the same read, so the two can never disagree.
   */
  secondsUnfed: number;
  prestigeLevel: number;
  /** All five escrowed letters uppercase. */
  upperAll: boolean;
  /** UPPERCASE letters in the word, 0..5 (the world read's "raised" board). Absent in old fixtures. */
  raised?: number;
  /** Its card number: its place in the order words were first made (lib/cardFacts `madeOrder`). */
  number?: number;
}

export interface RewardLeaf {
  tokenId: bigint;
  account: `0x${string}`;
  amount: bigint;
}

/** Weight scale: floats → integer millionths, exact under bigint division. */
const SCALE = 1_000_000n;

/** A word's share of the day: fed 1, peckish `peckishYieldFactor`, hungry 0. */
export function hungerFactor(daysUnfed: number, p: Params): number {
  if (daysUnfed >= p.care.hungryAfterDays) return 0;
  if (daysUnfed >= p.care.peckishAfterDays) return p.care.peckishYieldFactor;
  return 1;
}

/** Pro-rata split of `potWei` by float weights, exact and order-stable (sorted by tokenId). */
function split(
  entries: readonly { w: KeeperWord; weight: number }[],
  potWei: bigint,
): RewardLeaf[] {
  const weighted = entries
    .filter((e) => e.weight > 0)
    .map((e) => ({ ...e, wInt: BigInt(Math.round(e.weight * Number(SCALE))) }))
    .filter((e) => e.wInt > 0n)
    .sort((a, b) => (a.w.tokenId < b.w.tokenId ? -1 : 1));
  const total = weighted.reduce((a, e) => a + e.wInt, 0n);
  if (total === 0n || potWei <= 0n) return [];
  return weighted.map((e) => ({
    tokenId: e.w.tokenId,
    account: e.w.owner,
    amount: (potWei * e.wInt) / total,
  }));
}

/**
 * The daily UPPERCASE staking yield (v0.2 §1.5, YieldDistributor NatSpec, sim simulate.ts):
 * eligible = full-UPPERCASE + staked; weight = TIER_WEIGHT[tier] × hungerFactor ×
 * yieldMultPerLevel^prestige. Hungry words (factor 0) drop out entirely.
 */
export function yieldLeaves(
  words: readonly KeeperWord[],
  potWei: bigint,
  tier: TierOf,
  p: Params = DEFAULT_PARAMS,
): RewardLeaf[] {
  const entries = words.filter((w) => w.staked && w.upperAll).map((w) => ({ w, weight: yieldWeight(w, tier, p) }));
  return split(entries, potWei);
}

/**
 * One word's weight in the daily yield, exactly as `yieldLeaves` weighs it: 0 unless staked and all
 * UPPERCASE, else tier weight × hunger × the ascension multiplier. The world's "earns about X a day"
 * estimate (lib/wordCost.ts) sums this over every word, so it can't drift from the keeper's split.
 */
export function yieldWeight(
  w: Pick<KeeperWord, "word" | "staked" | "upperAll" | "daysUnfed" | "prestigeLevel">,
  tier: TierOf,
  p: Params = DEFAULT_PARAMS,
): number {
  if (!w.staked || !w.upperAll) return 0;
  return TIER_WEIGHT[tier(w.word)] * hungerFactor(w.daysUnfed, p) * p.prestige.yieldMultPerLevel ** w.prestigeLevel;
}

/**
 * The theme bounty (Bounty NatSpec, decisions.md "Renewable late-game loop"): eligible = staked +
 * theme-matching (+ not-hungry when the params say so); weight = TIER_WEIGHT^rarityWeight ×
 * bountyMultPerLevel^prestige. Case does NOT gate the bounty — that's its casual-reach virtue.
 */
export function bountyLeaves(
  words: readonly KeeperWord[],
  potWei: bigint,
  matches: (word: string) => boolean,
  tier: TierOf,
  p: Params = DEFAULT_PARAMS,
): RewardLeaf[] {
  const entries = words
    .filter(
      (w) =>
        w.staked &&
        matches(w.word) &&
        (!p.bounty.requiresNotHungry || w.daysUnfed < p.care.hungryAfterDays),
    )
    .map((w) => ({
      w,
      weight:
        TIER_WEIGHT[tier(w.word)] ** p.bounty.rarityWeight *
        p.prestige.bountyMultPerLevel ** w.prestigeLevel,
    }));
  return split(entries, potWei);
}

/** Total across leaves — callers assert this never exceeds the pot they asked to split. */
export function leavesTotal(leaves: readonly RewardLeaf[]): bigint {
  return leaves.reduce((a, l) => a + l.amount, 0n);
}
