/**
 * The keeper's Shop upkeep (decisions.md #22), pure parts, tested. The job itself is in jobs.ts,
 * next to `SaleFees.flush()` in the `fees` job:
 * - sweep the Shop's waiting USDC into the Rewards Pool (a no-op when nothing waits);
 * - catch the wardrobe up on Purchased events;
 * - take scene picks off words that left their profile.
 */
import type { KeeperWord } from "./shares";

/** Below a cent of waiting USDC there's nothing worth a transaction (and a dust swap may revert). */
export const MIN_SWEEP_USDC = 10_000n;

/** How far under the live price the keeper's own minimum sits: room for the route's fees (~0.7%). */
export const SWEEP_LIVE_SLIPPAGE_BPS = 500n;

/**
 * The keeper's `minWordOut` for a sweep: the USDC's worth at the LIVE price, less 5%. It sits above
 * the Shop's own floor whenever the peg lags a falling price (the floor reads the price keeper's peg,
 * which moves only on a 5% drift), so the keeper's sweep can't be the one a sandwich feeds on.
 * 0 (the Shop's floor alone) on a test network, where test $WORD has no market and the mock route
 * pays the peg, and whenever the price is the fallback, never a live one.
 */
export function sweepMinWordOut(a: {
  usdcIn: bigint;
  wordPerUsd: number;
  live: boolean;
  isTestnet: boolean;
}): bigint {
  if (a.isTestnet || !a.live || !(a.wordPerUsd > 0) || !Number.isFinite(a.wordPerUsd)) return 0n;
  // $WORD per USDC unit, in wei, from a float peg: 1e6 units = $1 → wordPerUsd × 1e18 wei.
  const weiPerUsd = BigInt(Math.floor(a.wordPerUsd)) * 10n ** 18n;
  const atLive = (a.usdcIn * weiPerUsd) / 1_000_000n;
  return (atLive * (10_000n - SWEEP_LIVE_SLIPPAGE_BPS)) / 10_000n;
}

/**
 * Each held word's profile (UPPERCASE word → its beneficial owner's account), for clearing picks off
 * words that left their profile. A staked word is still its staker's, so staking keeps the pick.
 */
export function holderProfiles(words: readonly KeeperWord[], accountOf: (wallet: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of words) out.set(w.word.toUpperCase(), accountOf(w.owner.toLowerCase()));
  return out;
}
