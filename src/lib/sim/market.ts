/**
 * Constant-product (Uniswap-v2) market layer — closes the sim's biggest blind spot.
 *
 * The game sim is USD-native: it converts USD↔$WORD at a flat peg and so cannot see slippage,
 * the reflexive pump, or peg-staleness. This layer takes the game sim's daily USD flows and
 * runs them through a real x·y=k pool to produce the $WORD PRICE PATH and the true
 * cost-to-play, given the thin ($21.5K) liquidity the token actually has.
 *
 * Model (per day):
 *   net USD flow into the pool = external buy demand (to pay fees) − winner sell-back
 *   apply it as a swap against reserves → new spot price
 *   repeg the on-chain USD→$WORD rate per a mechanical TWAP-ish policy (trigger % or N days)
 *   cost-to-play = spot / peg  (what players actually pay vs the USD target during the lag)
 *
 * It is intentionally aggregate (one net swap/day), not order-level — enough to size the
 * pump, the slippage, and the value of adding LP depth, which is what the launch decision needs.
 */

/** Total $WORD supply (≈100B, fully circulating). */
export const WORD_SUPPLY = 99_856_418_919;

export interface MarketParams {
  /** Starting DEX liquidity, USD (both sides). */
  initLiquidityUsd: number;
  /** Starting $WORD spot price, USD. */
  initPriceUsd: number;
  /** AMM swap fee (Uniswap v2 = 0.003). */
  fee: number;
  /** Fraction of daily player earnings (yield+jackpot) that winners sell rather than recycle. */
  sellbackRate: number;
  /** Repeg when |spot/peg − 1| exceeds this… */
  repegTriggerPct: number;
  /** …or at least every N days, whichever first (mechanical peg policy). */
  repegEveryDays: number;
  /** One-time treasury LP add at day 0 (USD, deepens the pool). */
  lpSeedUsd: number;
}

export const DEFAULT_MARKET: MarketParams = {
  initLiquidityUsd: 21566,
  initPriceUsd: 0.0000002368,
  fee: 0.003,
  sellbackRate: 0.5,
  repegTriggerPct: 0.1,
  repegEveryDays: 7,
  lpSeedUsd: 0,
};

export interface DailyFlow {
  externalInflowToday: number; // net new USD bought to play (buy pressure)
  earningsToday: number; // USD paid to players (yield + jackpot) — sell-back source
  burnToday: number; // USD burned that day
}

export interface MarketDay {
  day: number;
  price: number; // spot USD/$WORD
  peg: number; // on-chain USD/$WORD peg
  costToPlayMult: number; // spot / peg
  liquidityUsd: number;
  netFlowUsd: number;
}

export interface MarketResult {
  days: MarketDay[];
  startPrice: number;
  peakPrice: number;
  finalPrice: number;
  peakMult: number; // peak / start
  finalMult: number; // final / start
  maxCostToPlayMult: number; // worst overpay during a repeg lag
  startMcap: number;
  peakMcap: number;
  finalMcap: number;
  tokensBurned: number; // in $WORD (priced at each day's spot, so far smaller than the flat-peg estimate)
  tokensBurnedPctSupply: number;
}

/** Derive the per-day USD flows the market layer needs from a game-sim day series. */
export function flowsFromDays(
  days: { externalInflowTotal: number; distributionToday: number; jackpotPaidToday: number; burnedTotal: number }[],
): DailyFlow[] {
  const out: DailyFlow[] = [];
  for (let i = 0; i < days.length; i++) {
    const prev = days[i - 1];
    out.push({
      externalInflowToday: days[i].externalInflowTotal - (prev?.externalInflowTotal ?? 0),
      earningsToday: days[i].distributionToday + days[i].jackpotPaidToday,
      burnToday: days[i].burnedTotal - (prev?.burnedTotal ?? 0),
    });
  }
  return out;
}

export function marketSim(daily: DailyFlow[], mp: MarketParams = DEFAULT_MARKET): MarketResult {
  let rUsd = (mp.initLiquidityUsd + mp.lpSeedUsd) / 2;
  let rWord = rUsd / mp.initPriceUsd;
  const k = rUsd * rWord;
  let peg = mp.initPriceUsd;
  let sinceRepeg = 0;

  const startPrice = rUsd / rWord;
  let peakPrice = startPrice;
  let maxCtp = 1;
  let tokensBurned = 0;
  const out: MarketDay[] = [];

  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    const sellUsd = mp.sellbackRate * d.earningsToday;
    const netUsd = d.externalInflowToday - sellUsd;
    // The AMM fee always shrinks the EFFECTIVE swap size (less price impact), regardless of
    // direction — buys add slightly less USD to the reserve, sells remove slightly less. So
    // apply (1 − fee) to the flow magnitude either way (a sell is netUsd < 0).
    const eff = netUsd * (1 - mp.fee);
    rUsd = Math.max(1e-6, rUsd + eff);
    rWord = k / rUsd;
    const price = rUsd / rWord;
    peakPrice = Math.max(peakPrice, price);
    tokensBurned += d.burnToday / price; // burn in tokens shrinks as price climbs

    sinceRepeg++;
    if (Math.abs(price / peg - 1) > mp.repegTriggerPct || sinceRepeg >= mp.repegEveryDays) {
      peg = price;
      sinceRepeg = 0;
    }
    const ctp = price / peg;
    maxCtp = Math.max(maxCtp, ctp);
    out.push({ day: i, price, peg, costToPlayMult: ctp, liquidityUsd: 2 * rUsd, netFlowUsd: netUsd });
  }

  const finalPrice = out[out.length - 1]?.price ?? startPrice;
  const supplyLeft = WORD_SUPPLY - tokensBurned;
  return {
    days: out,
    startPrice,
    peakPrice,
    finalPrice,
    peakMult: peakPrice / startPrice,
    finalMult: finalPrice / startPrice,
    maxCostToPlayMult: maxCtp,
    startMcap: startPrice * WORD_SUPPLY,
    peakMcap: peakPrice * WORD_SUPPLY,
    finalMcap: finalPrice * supplyLeft,
    tokensBurned,
    tokensBurnedPctSupply: tokensBurned / WORD_SUPPLY,
  };
}
