/**
 * Renewable late-game loop experiment — does prestige + theme bounty fix the day-70 cliff?
 *
 * Two default-off levers (mirroring trading/dissolution): PRESTIGE (full-UPPERCASE staked words
 * ascend L1..L4, reusing roll+snack budget) and BOUNTY (a weekly featured CATEGORY pays staked +
 * not-hungry matching words pro-rata, funded zero-sum from pool inflow). We gate the product build
 * on what the sim can actually PROVE — and only that:
 *   1. Durable-sink REVIVAL — does fee throughput (rolls + snacks + prestige) keep flowing past
 *      mint-out, where the baseline decays to ~snacks-only?
 *   2. SOLVENCY + conservation — every new flow routes through the 4-bucket ledger / bounty pool
 *      and is asserted every day (the run completing IS the proof).
 *   3. DISTRIBUTION — does prestige concentrate yield onto whales? does the bounty reach casuals?
 *
 * What it does NOT prove: RETENTION. Churn is exogenous here (a live cohort is the honest artifact
 * for that — see docs/decisions.md). `chaseProbability` is the load-bearing behavioral assumption
 * (how often a claimer steers toward a matching word); it is swept, and magnitudes read as
 * sensitivity, not point estimates. Post-completion word-acquisition demand is also unmodelled
 * (no word secondary market) — so the bounty's demand effect is a LOWER bound.
 *
 *   npm run loop-exp
 */
import { runSim, DEFAULT_SIM_CONFIG, THEMES, THEME_WORDSETS } from "@/lib/sim/simulate";
import { DEFAULT_PARAMS, type Params } from "@/lib/params";
import type { SimResult, Archetype } from "@/lib/sim/types";
import { WORDS } from "@/lib/dictionary";

const NUM_WORDS = WORDS.length;

interface Opts {
  prestige?: boolean;
  bounty?: boolean;
  chaseProbability?: number;
  yieldMultPerLevel?: number;
  carveFraction?: number;
  rarityWeight?: number;
}
function makeParams(o: Opts): Params {
  return {
    ...DEFAULT_PARAMS,
    prestige: {
      ...DEFAULT_PARAMS.prestige,
      enabled: !!o.prestige,
      ...(o.yieldMultPerLevel !== undefined ? { yieldMultPerLevel: o.yieldMultPerLevel } : {}),
    },
    bounty: {
      ...DEFAULT_PARAMS.bounty,
      enabled: !!o.bounty,
      ...(o.chaseProbability !== undefined ? { chaseProbability: o.chaseProbability } : {}),
      ...(o.carveFraction !== undefined ? { carveFraction: o.carveFraction } : {}),
      ...(o.rarityWeight !== undefined ? { rarityWeight: o.rarityWeight } : {}),
    },
  };
}
const run = (seed: number, o: Opts): SimResult =>
  runSim({ ...DEFAULT_SIM_CONFIG, seed, params: makeParams(o) });

// ── metrics ─────────────────────────────────────────────────────────────────────────────────
const mintOutIdx = (r: SimResult) =>
  r.days.findIndex((d) => Object.values(d.capConsumption).every((c) => c >= 0.999));
const grossPastMintOut = (r: SimResult) => {
  const i = mintOutIdx(r);
  return i < 0 ? 0 : r.days.slice(i).reduce((a, d) => a + d.grossRoutedToday, 0);
};
const inflowPastMintOut = (r: SimResult) => {
  const i = mintOutIdx(r);
  return i < 0 ? 0 : r.final.externalInflowTotal - r.days[i].externalInflowTotal;
};
const completeDay = (r: SimResult) => {
  const i = r.days.findIndex((d) => d.totalClaims >= NUM_WORDS);
  return i >= 0 ? i + 1 : null;
};
const arch = (r: SimResult, a: Archetype) => r.playerRoi.find((x) => x.archetype === a)!;
const totalYield = (r: SimResult) => r.playerRoi.reduce((a, x) => a + x.yieldEarned, 0);
const yieldShare = (r: SimResult, a: Archetype) => {
  const t = totalYield(r);
  return t > 0 ? arch(r, a).yieldEarned / t : 0;
};
const totalBounty = (r: SimResult) => r.playerRoi.reduce((a, x) => a + x.bountyEarned, 0);
const bountyShare = (r: SimResult, a: Archetype) => {
  const t = totalBounty(r);
  return t > 0 ? arch(r, a).bountyEarned / t : 0;
};
const prestigeAttempts = (r: SimResult) => r.days.reduce((a, d) => a + d.prestigeAttemptsToday, 0);
// bountyEligibleWords is only set on period-end (resolution) days; the FINAL day usually isn't one,
// so average over the days that actually resolved rather than reading the final snapshot.
const avgEligible = (r: SimResult) => {
  const ds = r.days.filter((d) => d.bountyEligibleWords > 0);
  return ds.length ? Math.round(ds.reduce((a, d) => a + d.bountyEligibleWords, 0) / ds.length) : 0;
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const k = (n: number) => `${Math.round(n).toLocaleString()}`;
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;
const dPct = (now: number, base: number) =>
  base === 0 ? (now === 0 ? "—" : "+∞") : `${now >= base ? "+" : ""}${(((now - base) / Math.abs(base)) * 100).toFixed(0)}%`;
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

// ── theme reach context ─────────────────────────────────────────────────────────────────────
console.log(`\nTheme catalogue (the bounty rotates through these — reach varies by design):`);
for (let i = 0; i < THEMES.length; i++) {
  const n = THEME_WORDSETS[i].size;
  console.log(`  • ${pad(THEMES[i].name, 34)} ${padL(`${n}`, 5)} words (${pctOf(n / NUM_WORDS)} of dict)`);
}

// ── headline table (seed 1930): four scenarios ──────────────────────────────────────────────
const SEED = DEFAULT_SIM_CONFIG.seed;
const cols = [
  { name: "baseline", r: run(SEED, {}) },
  { name: "+prestige", r: run(SEED, { prestige: true }) },
  { name: "+bounty", r: run(SEED, { bounty: true }) },
  { name: "+both", r: run(SEED, { prestige: true, bounty: true }) },
];
const W = 14;
const moDay = mintOutIdx(cols[0].r);
console.log(`\nRenewable late-game loop — ${DEFAULT_SIM_CONFIG.days}d, ${DEFAULT_SIM_CONFIG.population} players, seed ${SEED}`);
console.log(`(mint-out ~day ${moDay + 1}; relative deltas are the signal, not absolute magnitudes)\n`);
console.log(pad("metric", 28) + cols.map((c) => padL(c.name, W)).join(""));
console.log("─".repeat(28 + W * cols.length));
function line(label: string, fmt: (r: SimResult) => string) {
  console.log(pad(label, 28) + cols.map((c) => padL(fmt(c.r), W)).join(""));
}

console.log("\nDURABLE-SINK REVIVAL (the cliff test — past mint-out)");
line("fee throughput past mint-out", (r) => k(grossPastMintOut(r)));
line("  Δ vs baseline", (r) => dPct(grossPastMintOut(r), grossPastMintOut(cols[0].r)));
line("ext. demand past mint-out", (r) => k(inflowPastMintOut(r)));
line("  Δ vs baseline", (r) => dPct(inflowPastMintOut(r), inflowPastMintOut(cols[0].r)));

console.log("\nCLAIM VELOCITY");
line("dictionary complete (day)", (r) => { const d = completeDay(r); return d ? `d${d}` : "never"; });
line("gross claims", (r) => k(r.final.claimsEverTotal));

console.log("\nYIELD CONCENTRATION (does prestige favour whales?)");
line("whale yield share", (r) => pctOf(yieldShare(r, "whale")));
line("staker yield share", (r) => pctOf(yieldShare(r, "staker")));
line("casual yield share", (r) => pctOf(yieldShare(r, "casual")));

console.log("\nBOUNTY REACH (does the goal reach the base?)");
line("bounty paid (total)", (r) => k(totalBounty(r)));
line("casual bounty share", (r) => (totalBounty(r) > 0 ? pctOf(bountyShare(r, "casual")) : "—"));
line("whale bounty share", (r) => (totalBounty(r) > 0 ? pctOf(bountyShare(r, "whale")) : "—"));
line("avg eligible words/period", (r) => k(avgEligible(r)));

console.log("\nPRESTIGE & CORE SANITY");
line("prestige levels held", (r) => k(r.final.prestigeLevelsTotal));
line("prestige attempts", (r) => k(prestigeAttempts(r)));
line("rewards pool (end)", (r) => usd(r.final.pool));
line("bounty pool (end, residual)", (r) => usd(r.final.bountyPool));
line("jackpot rollover %", (r) => `${((r.days.filter((d) => d.jackpotRolledOver).length / r.days.length) * 100).toFixed(0)}%`);

// ── sensitivity: chaseProbability (bounty on) ───────────────────────────────────────────────
console.log("\n\nSENSITIVITY — bounty.chaseProbability (the load-bearing behavioral assumption)");
console.log(pad("chaseProb", 12) + padL("complete day", 16) + padL("demand past MO", 18) + padL("casual bounty %", 18));
console.log("─".repeat(64));
for (const cp of [0.25, 0.5, 0.75, 1.0]) {
  const r = run(SEED, { bounty: true, chaseProbability: cp });
  const d = completeDay(r);
  console.log(
    pad(cp.toFixed(2), 12) +
      padL(d ? `d${d}` : "never", 16) +
      padL(k(inflowPastMintOut(r)), 18) +
      padL(totalBounty(r) > 0 ? pctOf(bountyShare(r, "casual")) : "—", 18),
  );
}

// ── sensitivity: prestige.yieldMultPerLevel (prestige on) ────────────────────────────────────
console.log("\nSENSITIVITY — prestige.yieldMultPerLevel (whale yield concentration)");
console.log(pad("mult/level", 12) + padL("whale yield %", 16) + padL("casual yield %", 16) + padL("levels held", 14));
console.log("─".repeat(58));
for (const m of [1.0, 1.1, 1.25, 1.5]) {
  const r = run(SEED, { prestige: true, yieldMultPerLevel: m });
  console.log(
    pad(m.toFixed(2), 12) +
      padL(pctOf(yieldShare(r, "whale")), 16) +
      padL(pctOf(yieldShare(r, "casual")), 16) +
      padL(k(r.final.prestigeLevelsTotal), 14),
  );
}
console.log(`  (mult=1.00 is the no-concentration control: prestige spend with flat yield weight)`);

// ── sensitivity: bounty.carveFraction (bounty on) ───────────────────────────────────────────
console.log("\nSENSITIVITY — bounty.carveFraction (yield → bounty redistribution)");
console.log(pad("carve", 12) + padL("pool (end)", 16) + padL("bounty paid", 16) + padL("casual bounty %", 18));
console.log("─".repeat(62));
for (const cf of [0.05, 0.15, 0.3]) {
  const r = run(SEED, { bounty: true, carveFraction: cf });
  console.log(
    pad(pctOf(cf), 12) +
      padL(usd(r.final.pool), 16) +
      padL(k(totalBounty(r)), 16) +
      padL(totalBounty(r) > 0 ? pctOf(bountyShare(r, "casual")) : "—", 18),
  );
}

// ── sensitivity: bounty.rarityWeight (the breadth ↔ rarity dial) ────────────────────────────
console.log("\nSENSITIVITY — bounty.rarityWeight (flat reach ↔ reward rare matching words)");
console.log(
  pad("rarityWt", 12) +
    padL("casual %", 12) +
    padL("collector %", 14) +
    padL("whale %", 12) +
    padL("bounty paid", 14),
);
console.log("─".repeat(64));
for (const rw of [0, 0.5, 1.0, 2.0]) {
  const r = run(SEED, { bounty: true, rarityWeight: rw });
  const tot = totalBounty(r);
  console.log(
    pad(rw.toFixed(1), 12) +
      padL(tot > 0 ? pctOf(bountyShare(r, "casual")) : "—", 12) +
      padL(tot > 0 ? pctOf(bountyShare(r, "collector")) : "—", 14) +
      padL(tot > 0 ? pctOf(bountyShare(r, "whale")) : "—", 12) +
      padL(k(tot), 14),
  );
}
console.log(`  (rarityWt=0 = flat: every match equal, max casual reach. default 1.0 = tier-proportional.)`);

// ── seed robustness: +both vs baseline (is the revival stable?) ──────────────────────────────
console.log("\n\nSEED ROBUSTNESS — +both vs baseline (does the sink-revival hold across seeds?)");
console.log(pad("seed", 8) + padL("gross past MO Δ", 18) + padL("complete b→both", 18) + padL("whale yield %", 16) + padL("casual bounty %", 18));
console.log("─".repeat(78));
for (const seed of [1930, 7, 42, 2024, 99]) {
  const b = run(seed, {});
  const x = run(seed, { prestige: true, bounty: true });
  const cd = (r: SimResult) => { const d = completeDay(r); return d ? `d${d}` : "never"; };
  console.log(
    pad(String(seed), 8) +
      padL(dPct(grossPastMintOut(x), grossPastMintOut(b)), 18) +
      padL(`${cd(b)}→${cd(x)}`, 18) +
      padL(pctOf(yieldShare(x, "whale")), 16) +
      padL(totalBounty(x) > 0 ? pctOf(bountyShare(x, "casual")) : "—", 18),
  );
}

// ── stress: everyone ascends + chases at chase=1.0 — solvency/conservation must survive ──────
console.log("\nSTRESS — both levers on, chaseProbability=1.0 (worst case for solvency/conservation)");
for (const seed of [1930, 7, 42]) {
  const r = run(seed, { prestige: true, bounty: true, chaseProbability: 1.0 });
  // the run completing means assertSolvent + assertBountyConserved held EVERY day; surface the residuals
  const ok = r.final.pool >= -1e-9 && r.final.jackpot >= -1e-9 && r.final.bountyPool >= -1e-9;
  console.log(
    `  seed ${pad(String(seed), 5)} → pool ${padL(usd(r.final.pool), 12)} jackpot ${padL(usd(r.final.jackpot), 10)} ` +
      `bountyPool ${padL(usd(r.final.bountyPool), 10)} levels ${padL(k(r.final.prestigeLevelsTotal), 8)}  ${ok ? "solvent ✓" : "INSOLVENT ✗"}`,
  );
}
console.log();
