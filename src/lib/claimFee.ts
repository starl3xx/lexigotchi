/**
 * The claim fee by rarity (decisions.md #60, the "gentle ladder"). Pure: no chain, no React.
 *
 * A word of tier T costs the base claim fee (Common's) times T's multiple. The multiples are the
 * tiers' earning weights over Common's (lib/economy.ts `CLAIM_MULTIPLE`), so the ladder in USD is
 * derived, never typed: Common $0.50, Uncommon $1.00, Rare $1.50, Legendary $2.50, Mythic $4.00 at
 * today's base. On chain the same multiples are `Words.tierMultiplierBps` (basis points of
 * `claimPrice`), which the owner can change: the game reads them from the chain (`GameParams`).
 *
 * A Words deployed before the ladder (Base Sepolia's until the held redeploy; the registry's
 * `claimTiers` says) charges every word `claimPrice`. Its `tierBps` is null here, and every tier
 * costs the base: what that contract really takes.
 *
 * The TIER a fee is for is always the game's tier (lib/rarity.ts `tierWith`: a collab word is
 * Legendary from its set's reveal), the same tier the dictionary leaf names.
 */
import { CLAIM_MULTIPLE, TIERS, TIER_INDEX, type Tier } from "./economy";
import { DEFAULT_PARAMS, claimFeeUsd, type Params } from "./params";
import { isSuiteDeployed, wordsHaveClaimTiers } from "./onchain/addresses";

/** 1×, in the basis points Words.tierMultiplierBps is written in. */
export const MULTIPLIER_ONE = 10_000;

/** The fee for `tier` in wei: the base times the tier's multiplier (flat when `tierBps` is null). */
export function claimFeeWei(baseWei: bigint, tierBps: readonly number[] | null, tier: Tier): bigint {
  if (!tierBps) return baseWei;
  const bps = tierBps[TIER_INDEX[tier]];
  // Words.claimFee: claimPrice * tierMultiplierBps[tier] / 10_000, rounded down, the same way.
  return (baseWei * BigInt(bps)) / BigInt(MULTIPLIER_ONE);
}

/** The fee for `tier` in whole $WORD, for display and affordability. */
export function claimFeeWord(baseWord: number, tierBps: readonly number[] | null, tier: Tier): number {
  if (!tierBps) return baseWord;
  return (baseWord * tierBps[TIER_INDEX[tier]]) / MULTIPLIER_ONE;
}

/**
 * Does the game charge by rarity HERE? Yes on a network whose Words has the ladder, and in the
 * practice game (no suite: it plays the game as decided). No on a network still running the older
 * Words. Copy that speaks of the ladder in general ("rarer words cost more") asks this, so the
 * test build never promises a price its contract doesn't charge.
 */
export function claimLadderLive(): boolean {
  return wordsHaveClaimTiers() || !isSuiteDeployed();
}

/** The practice game's multipliers, in basis points: the derived ladder (the contract's defaults). */
export const PRACTICE_TIER_BPS: readonly number[] = TIERS.map((t) => Math.round(CLAIM_MULTIPLE[t.name] * MULTIPLIER_ONE));

/** The ladder in USD at the params' base fee, rarest last: for tables in copy and the docs. */
export function claimLadderUsd(p: Params = DEFAULT_PARAMS): { tier: Tier; multiple: number; usd: number }[] {
  return TIERS.map((t) => ({ tier: t.name, multiple: p.claimMultiple[t.name], usd: claimFeeUsd(t.name, p) }));
}

/** "a Rare word", "an Uncommon word": a tier as a player reads it in a sentence. */
export function aTierWord(tier: Tier): string {
  return `${/^[AEIOU]/.test(tier) ? "an" : "a"} ${tier} word`;
}

/** Is `x` one of the five tier names (an answer from the proof route, say)? */
export function isTier(x: unknown): x is Tier {
  return typeof x === "string" && TIERS.some((t) => t.name === x);
}

/** "$1.50", or "$1" for a whole dollar: the ladder as the tester note and the docs write it. */
export function ladderDollars(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}
