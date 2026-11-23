/**
 * The $WORD swap's rules (the $WORD page's swap card; routes in /api/swap/*).
 *
 * Quotes and calldata come from KyberSwap's aggregator, which routes $WORD's Uniswap v4 (Clanker)
 * pool and needs no API key. Nothing about the trade is taken on trust from the aggregator:
 *  - only ETH, USDC, and $WORD, and every swap has $WORD on one side;
 *  - the router the calldata goes to is pinned (KYBER_ROUTER); a build naming any other is refused;
 *  - the recipient is the connected wallet (the build request sets it);
 *  - approvals are exact-amount, never unlimited, for this third-party router;
 *  - the paymaster is not offered (sendCallsAttributed `sponsored: false`).
 * The builder-code suffix rides along like every write (verified 2026-11-23: the router returns
 * the same amount for the same call with and without it, in an eth_call on Base).
 */

/** KyberSwap MetaAggregationRouterV2, the same address on every chain it supports. */
export const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as const;
export const KYBER_API = "https://aggregator-api.kyberswap.com/base/api/v1";
/** KyberSwap's placeholder for the chain's native coin. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export const SWAP_TOKENS = {
  ETH: { address: NATIVE, decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  WORD: { address: "0x304e649e69979298bd1aee63e175adf07885fb4b", decimals: 18 },
} as const;
export type SwapSymbol = keyof typeof SWAP_TOKENS;

export const isSwapSymbol = (s: unknown): s is SwapSymbol => s === "ETH" || s === "USDC" || s === "WORD";

/** A tradable pair: $WORD on exactly one side, ETH or USDC on the other. */
export function validPair(from: SwapSymbol, to: SwapSymbol): boolean {
  return from !== to && (from === "WORD") !== (to === "WORD");
}

export function symbolOf(address: string): SwapSymbol | null {
  const a = address.toLowerCase();
  for (const [sym, t] of Object.entries(SWAP_TOKENS)) if (t.address.toLowerCase() === a) return sym as SwapSymbol;
  return null;
}

/** Slippage the player may pick, in basis points. */
export const SLIPPAGE_BPS = { min: 10, default: 100, max: 500 } as const;

/** The least the trade may return at a slippage, rounding down. */
export function minOut(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** How much worse than the input's dollar value the output is, in percent (fees and impact). */
export function priceImpactPct(inUsd: number, outUsd: number): number | null {
  if (!(inUsd > 0) || !(outUsd >= 0)) return null;
  return Math.max(0, (1 - outUsd / inUsd) * 100);
}

/** Above this, the card refuses the trade: the pool is small, and the player would lose too much. */
export const MAX_IMPACT_PCT = 15;

/** Why a build answer can't be sent, or null if it can. Pure, so the guard is tested. */
export function checkBuild(
  built: { routerAddress?: string; amountIn?: string; data?: string },
  expected: { amountIn: string },
): string | null {
  if (!built.routerAddress || built.routerAddress.toLowerCase() !== KYBER_ROUTER.toLowerCase()) return "unexpected_router";
  if (built.amountIn !== expected.amountIn) return "amount_changed";
  if (!built.data || !/^0x[0-9a-fA-F]+$/.test(built.data)) return "bad_calldata";
  return null;
}
