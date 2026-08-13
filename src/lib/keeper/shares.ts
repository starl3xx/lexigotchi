import { DEFAULT_PARAMS, type Params } from "@/lib/params";
import { TIER_WEIGHT, wordTier } from "@/lib/economy";

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
  prestigeLevel: number;
  /** All five escrowed letters uppercase. */
  upperAll: boolean;
}

export interface RewardLeaf {
  tokenId: bigint;
  account: `0x${string}`;
  amount: bigint;
}

/** Weight scale: floats → integer millionths, exact under bigint division. */
const SCALE = 1_000_000n;

function hungerFactor(daysUnfed: number, p: Params): number {
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
  p: Params = DEFAULT_PARAMS,
): RewardLeaf[] {
  const entries = words
    .filter((w) => w.staked && w.upperAll)
    .map((w) => ({
      w,
      weight:
        TIER_WEIGHT[wordTier(w.word)] *
        hungerFactor(w.daysUnfed, p) *
        p.prestige.yieldMultPerLevel ** w.prestigeLevel,
    }));
  return split(entries, potWei);
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
        TIER_WEIGHT[wordTier(w.word)] ** p.bounty.rarityWeight *
        p.prestige.bountyMultPerLevel ** w.prestigeLevel,
    }));
  return split(entries, potWei);
}

/** Total across leaves — callers assert this never exceeds the pot they asked to split. */
export function leavesTotal(leaves: readonly RewardLeaf[]): bigint {
  return leaves.reduce((a, l) => a + l.amount, 0n);
}
