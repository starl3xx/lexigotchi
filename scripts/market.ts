/**
 * Market layer report — runs the game sim, then pushes its daily USD flows through the
 * constant-product $WORD pool to show the real price path the flat-peg sim can't see.
 *   npm run market
 */
import { runSim, DEFAULT_SIM_CONFIG } from "../src/lib/sim/simulate";
import { marketSim, flowsFromDays, DEFAULT_MARKET, type MarketParams } from "../src/lib/sim/market";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const population = arg("population", 800);
const days = arg("days", 270);

const x = (m: number) => `${m.toFixed(1)}×`;
const $ = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`);
const price = (p: number) => `$${p.toExponential(2)}`;

const res = runSim({ ...DEFAULT_SIM_CONFIG, population, days });
const flows = flowsFromDays(res.days);
const totalDemand = res.final.externalInflowTotal;

console.log(`\n=== LEXIGOTCHI MARKET LAYER (constant-product $WORD pool) ===`);
console.log(`game sim: ${population} players, ${days} days · total $WORD buy-demand $${Math.round(totalDemand).toLocaleString()}`);
console.log(
  `pool start: $${DEFAULT_MARKET.initLiquidityUsd.toLocaleString()} liquidity · $WORD $${DEFAULT_MARKET.initPriceUsd} · mcap $${Math.round((DEFAULT_MARKET.initPriceUsd * 99_856_418_919)).toLocaleString()}`,
);

function row(label: string, mp: Partial<MarketParams>) {
  const m = marketSim(flows, { ...DEFAULT_MARKET, ...mp });
  console.log(
    [
      label.padEnd(22),
      `peak ${x(m.peakMult)}`.padStart(11),
      `final ${x(m.finalMult)}`.padStart(12),
      `peakMcap ${$(m.peakMcap)}`.padStart(17),
      `maxCost ${x(m.maxCostToPlayMult)}`.padStart(13),
      `burned ${(m.tokensBurnedPctSupply * 100).toFixed(1)}%`.padStart(14),
      `endLiq ${$(m.days[m.days.length - 1].liquidityUsd)}`.padStart(14),
    ].join(""),
  );
}

console.log(`\n--- scenarios (peak/final = $WORD price multiple; maxCost = worst cost-to-play overpay) ---`);
row("base (no LP add)", {});
row("+$1.5K treasury LP", { lpSeedUsd: 1500 });
row("+$5K treasury LP", { lpSeedUsd: 5000 });
row("+$10K treasury LP", { lpSeedUsd: 10000 });
console.log(`  -- peg cadence (at +$5K LP) --`);
row("repeg weekly", { lpSeedUsd: 5000, repegEveryDays: 7, repegTriggerPct: 0.15 });
row("repeg 3d / 10%", { lpSeedUsd: 5000, repegEveryDays: 3, repegTriggerPct: 0.1 });
console.log(`  -- winner sell-back sensitivity (at +$5K LP) --`);
row("sellback 30%", { lpSeedUsd: 5000, sellbackRate: 0.3 });
row("sellback 70%", { lpSeedUsd: 5000, sellbackRate: 0.7 });

const base = marketSim(flows, DEFAULT_MARKET);
console.log(`\n--- price path (base, no LP add) ---`);
for (const d of [0, 29, 59, 89, 179, days - 1].filter((d, i, a) => d < days && a.indexOf(d) === i)) {
  const md = base.days[d];
  console.log(`  day ${String(d + 1).padStart(3)}: ${price(md.price)}  (${x(md.price / base.startPrice)})  cost-to-play ${x(md.costToPlayMult)}  liq ${$(md.liquidityUsd)}`);
}

console.log(`\nKey takeaways:`);
console.log(`• Naive launch pumps $WORD ~${x(base.peakMult)} (peak mcap ${$(base.peakMcap)}) — bullish, but a violent, thin-book move the peg must chase.`);
console.log(`• Burn in token terms is ~${(base.tokensBurnedPctSupply * 100).toFixed(1)}% of supply, NOT the 42% the flat-peg sim implied (each $WORD is worth more as it's burned).`);
console.log(`• Adding treasury LP flattens the pump and the overpay: compare maxCost across the LP rows — depth is the real lever.`);
console.log(`• Caveat: demand is held at the game sim's level; in reality high cost-to-play would damp demand (a stabilising second-order effect not modelled).\n`);
