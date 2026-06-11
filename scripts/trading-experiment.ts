/**
 * Secondary-market experiment — does modeled letter liquidity justify a swap-primitive build?
 *
 * The non-goal is a custom marketplace; the candidate build is a two-sided swap escrow. Before
 * building it, we gate on the sim: turn on a SIMPLE clearing assumption (surplus letters list
 * and clear at a floor; blocked claimers buy toward their nearest word) and on DISSOLUTION (the
 * v0.1 §5.4 exit), independently, and see whether either moves the two things they're supposed
 * to: claim velocity and casual accessibility.
 *
 * Recoup is reported from `recoup` (the isolated proceeds-from-selling-letters field), NOT from
 * total `earned` — total earned is dominated by lumpy jackpot/yield and would mislead. A seed
 * sweep follows the headline table because the per-seed effect is small and noisy.
 *
 *   npm run trade-exp
 */
import { runSim, DEFAULT_SIM_CONFIG, type SimConfig } from "@/lib/sim/simulate";
import { DEFAULT_PARAMS, type Params } from "@/lib/params";
import type { SimResult } from "@/lib/sim/types";
import { WORDS } from "@/lib/dictionary";

const NUM_WORDS = WORDS.length;

function withLevers(trading: boolean, dissolution: boolean): Params {
  return {
    ...DEFAULT_PARAMS,
    trading: { ...DEFAULT_PARAMS.trading, enabled: trading },
    dissolution: { ...DEFAULT_PARAMS.dissolution, enabled: dissolution },
  };
}
const run = (seed: number, trading: boolean, dissolution: boolean): SimResult =>
  runSim({ ...DEFAULT_SIM_CONFIG, seed, params: withLevers(trading, dissolution) });

const casual = (r: SimResult) => r.playerRoi.find((x) => x.archetype === "casual")!;
const completeDay = (r: SimResult) => {
  const i = r.days.findIndex((d) => d.totalClaims >= NUM_WORDS);
  return i >= 0 ? i + 1 : null;
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (now: number, base: number) =>
  base === 0 ? (now === 0 ? "—" : "+∞") : `${now >= base ? "+" : ""}${(((now - base) / Math.abs(base)) * 100).toFixed(0)}%`;
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

// ── headline table (seed 1930): four scenarios ─────────────────────────────────────────────
const SEED = DEFAULT_SIM_CONFIG.seed;
const cols = [
  { name: "baseline", r: run(SEED, false, false) },
  { name: "+trading", r: run(SEED, true, false) },
  { name: "+dissolution", r: run(SEED, false, true) },
  { name: "+both", r: run(SEED, true, true) },
];
const base = cols[0].r;
const W = 15;

console.log(`\nSecondary-market experiment — ${DEFAULT_SIM_CONFIG.days}d, ${DEFAULT_SIM_CONFIG.population} players, seed ${SEED}`);
console.log("(USD-native; relative deltas are the signal, not absolute magnitudes)\n");
console.log(pad("metric", 26) + cols.map((c) => padL(c.name, W)).join(""));
console.log("─".repeat(26 + W * cols.length));

function line(label: string, fmt: (r: SimResult) => string) {
  console.log(pad(label, 26) + cols.map((c) => padL(fmt(c.r), W)).join(""));
}

console.log("\nCLAIM VELOCITY");
line("dictionary complete (day)", (r) => { const d = completeDay(r); return d ? `d${d}` : "never"; });
line("gross claims (churn)", (r) => r.final.claimsEverTotal.toLocaleString());
line("unique words held (end)", (r) => r.final.totalClaims.toLocaleString());

console.log("\nCASUAL ACCESSIBILITY (50% of base)");
line("recoup from selling ($)", (r) => usd(casual(r).recoup));
line("  Δ vs baseline", (r) => pct(casual(r).recoup, casual(base).recoup));
line("recoup / casual spend", (r) => `${((casual(r).recoup / casual(r).spent) * 100).toFixed(1)}%`);
line("avg claims / casual", (r) => (casual(r).claims / casual(r).players).toFixed(3));
line("  Δ vs baseline", (r) => pct(casual(r).claims / casual(r).players, casual(base).claims / casual(base).players));
line("casual net ROI (total)", (r) => usd(casual(r).net));

console.log("\nLEVER ACTIVITY & CORE SANITY");
line("letters cleared", (r) => r.final.lettersTradedTotal.toLocaleString());
line("words dissolved", (r) => r.final.dissolutionsTotal.toLocaleString());
line("rewards pool (end)", (r) => usd(r.final.pool));
line("jackpot rollover %", (r) => `${((r.days.filter((d) => d.jackpotRolledOver).length / r.days.length) * 100).toFixed(0)}%`);

// ── seed robustness: baseline vs +trading across seeds (is the effect stable?) ──────────────
console.log("\n\nSEED ROBUSTNESS — baseline vs +trading (does the effect hold across seeds?)");
console.log(pad("seed", 8) + padL("recoup $/casual", 18) + padL("recoup/spend", 14) + padL("claims/casual Δ", 18) + padL("complete b→t", 16) + padL("cleared", 10));
console.log("─".repeat(84));
for (const seed of [1930, 7, 42, 2024, 99]) {
  const b = run(seed, false, false);
  const t = run(seed, true, false);
  const tc = casual(t), bc = casual(b);
  const cd = (r: SimResult) => { const d = completeDay(r); return d ? `d${d}` : "never"; };
  console.log(
    pad(String(seed), 8) +
      padL(usd(tc.recoup / tc.players), 18) +
      padL(`${((tc.recoup / tc.spent) * 100).toFixed(1)}%`, 14) +
      padL(pct(tc.claims / tc.players, bc.claims / bc.players), 18) +
      padL(`${cd(b)}→${cd(t)}`, 16) +
      padL(t.final.lettersTradedTotal.toLocaleString(), 10),
  );
}
console.log();
