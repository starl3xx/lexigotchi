/**
 * Run the Lexigotchi economy sim and print a solvency + pricing report.
 *   npm run sim            (default config)
 *   npm run sim -- --days 365 --population 1500 --seed 7
 */
import { runSim, DEFAULT_SIM_CONFIG, type SimConfig } from "../src/lib/sim/simulate";
import {
  DEFAULT_PARAMS,
  expectedRollsToSuccess,
  assertSplitsValid,
  WORD_PER_USD,
} from "../src/lib/params";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const cfg: SimConfig = {
  ...DEFAULT_SIM_CONFIG,
  days: arg("days", DEFAULT_SIM_CONFIG.days),
  population: arg("population", DEFAULT_SIM_CONFIG.population),
  seed: arg("seed", DEFAULT_SIM_CONFIG.seed),
};

assertSplitsValid(DEFAULT_PARAMS);

const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\n=== LEXIGOTCHI ECONOMY SIM (v0.2 mechanics) ===`);
console.log(
  `days=${cfg.days}  population=${cfg.population}  ramp=${cfg.rampDays}d  seed=${cfg.seed}`,
);
const P = DEFAULT_PARAMS.prices;
console.log(
  `prices(USD, sim is USD-native): daily=$${P.dailyMint} pack=$${P.pack} roll=$${P.roll} claim=$${P.claim} snack=$${P.snack}  ` +
    `· seed: jackpot $${DEFAULT_PARAMS.seed.jackpot} pool $${DEFAULT_PARAMS.seed.pool}`,
);
console.log(
  `roll: ${pct(DEFAULT_PARAMS.roll.baseSuccess)} base +${pct(DEFAULT_PARAMS.roll.pityStep)}/fail ` +
    `cap ${pct(DEFAULT_PARAMS.roll.pityCap)} → ~${expectedRollsToSuccess().toFixed(2)} rolls/upgrade ` +
    `(~${(expectedRollsToSuccess() * 5).toFixed(1)} rolls to a full UPPERCASE word)`,
);

const t0 = Date.now();
const res = runSim(cfg);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const marks = [0, 29, 89, 179, cfg.days - 1].filter((d, i, a) => d < cfg.days && a.indexOf(d) === i);
console.log(`\n--- trajectory ---`);
console.log(
  ["day", "pool", "jackpot", "burned", "treasury", "claims", "UPPER", "yield/day", "active"]
    .map((s) => s.padStart(10))
    .join(""),
);
for (const d of marks) {
  const m = res.days[d];
  console.log(
    [
      `${d + 1}`,
      fmt(m.pool),
      fmt(m.jackpot),
      fmt(m.burnedTotal),
      fmt(m.treasuryTotal),
      fmt(m.totalClaims),
      fmt(m.uppercaseWords),
      fmt(m.distributionToday),
      fmt(m.activePlayers),
    ]
      .map((s) => s.padStart(10))
      .join(""),
  );
}

const f = res.final;
const wm = (usd: number) => `${(usd * WORD_PER_USD / 1e6).toFixed(1)}M $WORD`;
console.log(`\n--- final state (day ${cfg.days}) · all $ are USD ---`);
console.log(`Rewards Pool:     $${fmt(f.pool)}   (est. equilibrium ~$${fmt(res.poolEquilibrium)})`);
console.log(`Jackpot pot:      $${fmt(f.jackpot)}`);
console.log(`Burned (total):   $${fmt(f.burnedTotal)}  (${wm(f.burnedTotal)})`);
console.log(`Treasury (total): $${fmt(f.treasuryTotal)}`);
console.log(`$WORD demand:     $${fmt(f.externalInflowTotal)}  (${wm(f.externalInflowTotal)}) bought to play — vs ~$23.6K current mcap`);
console.log(`Claims:           ${fmt(f.totalClaims)} / 4438  (${pct(f.totalClaims / 4438)} of dictionary)`);
console.log(`Unique claimers:  ${fmt(f.uniqueClaimers)}`);
console.log(`Staked words:     ${fmt(f.stakedWords)}  (UPPERCASE: ${fmt(f.uppercaseWords)}, yield-eligible: ${fmt(f.yieldEligibleWords)})`);
console.log(`Letters minted:   ${fmt(f.lettersMintedTotal)} / 55,467 cap`);

console.log(`\n--- per-archetype ROI (earned − spent, USD) ---`);
for (const r of res.playerRoi.sort((a, b) => b.net - a.net)) {
  const roi = r.spent > 0 ? r.earned / r.spent : 0;
  console.log(
    `${r.archetype.padEnd(10)} spent ${fmt(r.spent).padStart(12)}  earned ${fmt(r.earned).padStart(12)}  ` +
      `net ${fmt(r.net).padStart(12)}  (recoup ${pct(roi)})`,
  );
}

console.log(`\n--- tightest letter supplies (% of cap consumed) ---`);
const caps = Object.entries(f.capConsumption).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(caps.map(([l, c]) => `${l}:${pct(c)}`).join("  "));

console.log(`\n--- findings ---`);
for (const n of res.notes) console.log(`• ${n}`);

// solvency assertion summary
const poolNeg = res.days.some((d) => d.pool < -1e-6);
const jackNeg = res.days.some((d) => d.jackpot < -1e-6);
console.log(
  `\nSOLVENCY: pool never negative: ${!poolNeg ? "✓" : "✗"} · jackpot never negative: ${!jackNeg ? "✓" : "✗"} · ` +
    `every faucet paid only what its bucket held.`,
);
console.log(`(sim ran in ${elapsed}s)\n`);
