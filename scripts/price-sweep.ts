/**
 * Price-sweep harness — turns the solvency sim into a pricing tool.
 *
 * Pricing is USD-pegged, so the sim runs in USD and every monetary output is dollars. The
 * on-chain $WORD amount for a USD price is priceWord(usd) at the current peg. Because the
 * economy's BALANCE depends only on the ratio of player spend appetite to action prices,
 * the relative outcomes are independent of the $WORD price — it only sets the $WORD amounts.
 *
 *   npm run sweep
 */
import { runSim, DEFAULT_SIM_CONFIG } from "../src/lib/sim/simulate";
import { DEFAULT_PARAMS, WORD_USD_PRICE, WORD_PER_USD, priceWord, type Params } from "../src/lib/params";
import type { SimResult } from "../src/lib/sim/types";

const $ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const $c = (v: number) => `$${v.toFixed(2)}`;
const word = (usd: number) => `${(priceWord(usd) / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (d: number | null) => (d === null ? ">run" : `d${d}`);

function withPrices(base: Params, o: Partial<Params["prices"]>): Params {
  return { ...base, prices: { ...base.prices, ...o } };
}
function scaleAll(base: Params, k: number): Params {
  const p = base.prices;
  return withPrices(base, {
    pack: p.pack * k, dailyMint: p.dailyMint * k, roll: p.roll * k, claim: p.claim * k, snack: p.snack * k,
  });
}
/** A regime with no treasury seed (to isolate fee-funded dynamics) or with the default seed. */
function noSeed(p: Params): Params {
  return { ...p, seed: { jackpot: 0, pool: 0 } };
}

interface M {
  mintOut: number | null;
  complete: number | null;
  poolEq: number;
  dailyBurn: number;
  demand: number;
  casualRecoup: number;
  stakerRecoup: number;
  whaleRecoup: number;
  casualClaimShare: number;
  avgJackpot: number;
  rolloverPct: number;
}

function metrics(res: SimResult): M {
  const D = res.days;
  const last = D[D.length - 1];
  const firstAll = (pred: (d: (typeof D)[number]) => boolean) => {
    const i = D.findIndex(pred);
    return i < 0 ? null : i + 1;
  };
  const win = Math.min(60, D.length - 1);
  const dailyBurn = (last.burnedTotal - D[D.length - 1 - win].burnedTotal) / win;
  const totalClaims = res.playerRoi.reduce((a, r) => a + r.claims, 0) || 1;
  const recoup = (a: string) => {
    const r = res.playerRoi.find((x) => x.archetype === a);
    return r && r.spent > 0 ? r.earned / r.spent : 0;
  };
  const casual = res.playerRoi.find((r) => r.archetype === "casual");
  return {
    mintOut: firstAll((d) => Object.values(d.capConsumption).every((c) => c >= 0.999)),
    complete: firstAll((d) => d.totalClaims >= 4438),
    poolEq: res.poolEquilibrium,
    dailyBurn,
    demand: last.externalInflowTotal,
    casualRecoup: recoup("casual"),
    stakerRecoup: recoup("staker"),
    whaleRecoup: recoup("whale"),
    casualClaimShare: (casual?.claims ?? 0) / totalClaims,
    avgJackpot: res.jackpotWins.length
      ? res.jackpotWins.reduce((a, x) => a + x.amount, 0) / res.jackpotWins.length
      : 0,
    rolloverPct: D.filter((d) => d.jackpotRolledOver).length / D.length,
  };
}

function run(params: Params, population: number, days = 270): M {
  return metrics(runSim({ ...DEFAULT_SIM_CONFIG, params, population, days, seed: 1930 }));
}

console.log(`\n=== LEXIGOTCHI PRICE SWEEP (USD-pegged) ===`);
console.log(
  `Live $WORD peg: $${WORD_USD_PRICE}  ($1 = ${(WORD_PER_USD / 1e6).toFixed(2)}M $WORD). Sim runs in USD.`,
);
const base = DEFAULT_PARAMS.prices;
console.log(
  `Base prices (USD → $WORD): pack ${$c(base.pack)} (${word(base.pack)}) · daily ${$c(base.dailyMint)} (${word(base.dailyMint)}) · ` +
    `roll ${$c(base.roll)} (${word(base.roll)}) · claim ${$c(base.claim)} (${word(base.claim)}) · snack ${$c(base.snack)} (${word(base.snack)})`,
);
console.log(
  `Treasury seed: jackpot ${$c(DEFAULT_PARAMS.seed.jackpot)} (${word(DEFAULT_PARAMS.seed.jackpot)} $WORD) · pool ${$c(DEFAULT_PARAMS.seed.pool)} (${word(DEFAULT_PARAMS.seed.pool)} $WORD)`,
);

// ---- 1) overall price LEVEL × population (DAU) ----
console.log(`\n--- (1) price level × population (all $ are USD) ---`);
console.log(["level", "pop", "mintOut", "complete", "poolEq", "burn/day", "demand", "casual%", "staker%", "rollover", "avgJack"].map((s) => s.padStart(10)).join(""));
for (const k of [0.5, 1, 2]) {
  for (const pop of [200, 800, 3000]) {
    const m = run(scaleAll(DEFAULT_PARAMS, k), pop);
    console.log(
      [`${k}×`, `${pop}`, day(m.mintOut), day(m.complete), $(m.poolEq), $(m.dailyBurn), $(m.demand), pct(m.casualRecoup), pct(m.stakerRecoup), pct(m.rolloverPct), $(m.avgJackpot)]
        .map((s) => `${s}`.padStart(10))
        .join(""),
    );
  }
}

// ---- 2) structural regimes at 800 players (tune the RATIOS) ----
console.log(`\n--- (2) structural regimes (800 players) ---`);
const regimes: { name: string; params: Params }[] = [
  { name: "base", params: DEFAULT_PARAMS },
  { name: "accessible", params: withPrices(DEFAULT_PARAMS, { claim: 0.3, snack: 0.01, dailyMint: 0.03 }) },
  { name: "premium", params: scaleAll(DEFAULT_PARAMS, 1.6) },
  { name: "grindy", params: withPrices(DEFAULT_PARAMS, { roll: 0.25, claim: 0.35 }) },
  { name: "cheap-care", params: withPrices(DEFAULT_PARAMS, { snack: 0.008 }) },
  { name: "base(no-seed)", params: noSeed(DEFAULT_PARAMS) },
];
console.log(["regime", "mintOut", "poolEq", "burn/day", "casual%", "staker%", "whale%", "cslClaim", "rollover", "avgJack"].map((s) => s.padStart(13)).join(""));
for (const r of regimes) {
  const m = run(r.params, 800);
  console.log(
    [r.name, day(m.mintOut), $(m.poolEq), $(m.dailyBurn), pct(m.casualRecoup), pct(m.stakerRecoup), pct(m.whaleRecoup), pct(m.casualClaimShare), pct(m.rolloverPct), $(m.avgJackpot)]
      .map((s) => `${s}`.padStart(13))
      .join(""),
  );
}

console.log(`\nNotes:`);
console.log(`• All $ are USD (sim is USD-native). $WORD amounts = USD × ${(WORD_PER_USD / 1e6).toFixed(2)}M.`);
console.log(`• "demand" = external $WORD bought to play over the run — compare to the ~$23.6K current mcap.`);
console.log(`• recoup% = $ earned vs spent (a sink economy is <100% by design); jackpot/pool include the treasury seed.`);
console.log(`• Reminder: the sim omits secondary letter trading, so casual accessibility is understated.\n`);
