/**
 * The price keeper's plan: which onchain prices to move, and to what, so each stays near its USD
 * target as the $WORD price moves (decisions.md "Launch decisions" #7, `RepegKeeper` on chain).
 *
 * Pure: it takes the live price and the contracts' current prices and returns the calls to make,
 * so every guard below is tested without a chain (tests/repeg.test.ts). The guards, in order:
 *   - A live price only. The oracle's fallback constant is a guess, never a reason to move money.
 *   - A liquidity floor. A thin pool's price is cheap to push; below the floor nothing moves.
 *   - Drift threshold (5%): small wiggles are not worth a transaction or a price change.
 *   - Never touch a zero price (the FREE daily). The contract refuses it anyway; we don't ask.
 *   - Clamp each move to the contract's own `maxMoveBps` (and the 25%/day policy cap), one bps
 *     inside the band, so the call can't revert `RepegTooLarge` on rounding. A big gap closes over
 *     several daily runs instead of in one jump.
 */
/** The priced items, as the game names them (state.tsx PriceItem). */
export type RepegItem = "pack" | "daily" | "roll" | "claim" | "snack" | "prestige" | "prestigeSnack";

export interface RepegPolicy {
  /** Minimum relative drift before a price moves, in bps. */
  driftBps: number;
  /** The off-chain cap per run, in bps (the onchain maxMoveBps also applies; the tighter wins). */
  policyCapBps: number;
  /** Below this pool depth (USD), the price is too easy to push: move nothing. */
  minReserveUsd: number;
}

export const DEFAULT_POLICY: RepegPolicy = { driftBps: 500, policyCapBps: 2_500, minReserveUsd: 5_000 };

export interface LivePrice {
  priceUsd: number;
  reserveUsd: number | null;
  source: "geckoterminal" | "fallback";
}

/** One price as the chain holds it, plus its USD target. */
export interface PricePoint {
  item: RepegItem;
  currentWei: bigint;
  targetUsd: number;
}

export interface PriceMove {
  item: RepegItem;
  fromWei: bigint;
  toWei: bigint;
  /** True when the clamp stopped short of the target (the next run continues). */
  clamped: boolean;
}

export type RepegPlan =
  | { ok: true; moves: PriceMove[] }
  | { ok: false; reason: "fallback_price" | "thin_liquidity" | "bad_price" };

const WEI = 10n ** 18n;
const BPS = 10_000n;

/** The $WORD amount (wei, whole tokens) that is `usd` at `priceUsd`. */
export function targetWei(usd: number, priceUsd: number): bigint {
  return BigInt(Math.round(usd / priceUsd)) * WEI;
}

export function planRepeg(
  live: LivePrice,
  points: readonly PricePoint[],
  maxMoveBps: number,
  policy: RepegPolicy = DEFAULT_POLICY,
): RepegPlan {
  if (live.source !== "geckoterminal") return { ok: false, reason: "fallback_price" };
  if (!Number.isFinite(live.priceUsd) || live.priceUsd <= 0) return { ok: false, reason: "bad_price" };
  if (live.reserveUsd == null || live.reserveUsd < policy.minReserveUsd) return { ok: false, reason: "thin_liquidity" };

  // One bps inside the band: the contract reverts when delta * 10000 > current * maxMoveBps.
  const capBps = BigInt(Math.max(0, Math.min(maxMoveBps, policy.policyCapBps) - 1));
  const moves: PriceMove[] = [];
  for (const p of points) {
    if (p.currentWei === 0n || p.targetUsd <= 0) continue; // free stays free; on/off zero is owner-only
    if (capBps === 0n) continue; // repeg disabled onchain (maxMoveBps 0 or 1)
    const target = targetWei(p.targetUsd, live.priceUsd);
    if (target === 0n) continue;
    const delta = target > p.currentWei ? target - p.currentWei : p.currentWei - target;
    if (delta * BPS < p.currentWei * BigInt(policy.driftBps)) continue; // within the drift threshold
    const room = (p.currentWei * capBps) / BPS;
    const toWei = target > p.currentWei
      ? (target - p.currentWei > room ? p.currentWei + room : target)
      : (p.currentWei - target > room ? p.currentWei - room : target);
    if (toWei === p.currentWei) continue;
    moves.push({ item: p.item, fromWei: p.currentWei, toWei, clamped: toWei !== target });
  }
  return { ok: true, moves };
}
