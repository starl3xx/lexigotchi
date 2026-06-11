import { describe, it, expect } from "vitest";
import { runSim, DEFAULT_SIM_CONFIG, type SimConfig } from "@/lib/sim/simulate";
import { DEFAULT_PARAMS, type Params } from "@/lib/params";

interface Opts {
  prestige?: boolean;
  bounty?: boolean;
  chaseProbability?: number;
  yieldMultPerLevel?: number;
}
function params(o: Opts): Params {
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
    },
  };
}
const cfg = (o: Opts): SimConfig => ({
  ...DEFAULT_SIM_CONFIG,
  days: 120,
  population: 400,
  params: params(o),
});

const sumPrestigeAttempts = (r: ReturnType<typeof runSim>) =>
  r.days.reduce((a, d) => a + d.prestigeAttemptsToday, 0);
const sumBountyPaid = (r: ReturnType<typeof runSim>) =>
  r.days.reduce((a, d) => a + d.bountyPaidToday, 0);

describe("renewable late-game loop levers (sim)", () => {
  it("are OFF by default — baseline parity (no prestige, no bounty)", () => {
    const r = runSim(cfg({}));
    expect(r.final.prestigeLevelsTotal).toBe(0);
    expect(sumPrestigeAttempts(r)).toBe(0);
    expect(r.final.bountyPool).toBe(0);
    expect(r.final.bountyCarvedTotal).toBe(0);
    expect(r.final.bountyPaidTotal).toBe(0);
    expect(sumBountyPaid(r)).toBe(0);
  });

  it("the OFF path draws zero RNG — toggling lever knobs while disabled is byte-identical", () => {
    // rewrite-safety: prestige/bounty code must be inert when off (no extra rng.chance), so changing
    // a non-enabling param must NOT perturb the mulberry32 stream. If the economy diverged, the off
    // path is leaking draws (the bug class that breaks determinism).
    const ref = runSim(cfg({}));
    const a = runSim(cfg({ chaseProbability: 1.0 })); // bounty still OFF
    const b = runSim(cfg({ yieldMultPerLevel: 1.5 })); // prestige still OFF
    for (const v of [a, b]) {
      expect(v.final.pool).toBe(ref.final.pool);
      expect(v.final.claimsEverTotal).toBe(ref.final.claimsEverTotal);
      expect(v.final.totalClaims).toBe(ref.final.totalClaims);
      expect(v.jackpotWins.length).toBe(ref.jackpotWins.length);
      expect(v.days.map((d) => d.activePlayers)).toEqual(ref.days.map((d) => d.activePlayers));
    }
  });

  it("is deterministic for the same (config, seed) with both levers on", () => {
    const a = runSim(cfg({ prestige: true, bounty: true }));
    const b = runSim(cfg({ prestige: true, bounty: true }));
    expect(a.final.pool).toBe(b.final.pool);
    expect(a.final.prestigeLevelsTotal).toBe(b.final.prestigeLevelsTotal);
    expect(a.final.bountyPaidTotal).toBe(b.final.bountyPaidTotal);
    expect(a.final.claimsEverTotal).toBe(b.final.claimsEverTotal);
  });

  it("stays solvent with both levers on (carve is zero-sum; payouts cap at balances)", () => {
    const r = runSim(cfg({ prestige: true, bounty: true })); // runSim asserts solvency every day
    expect(r.final.pool).toBeGreaterThanOrEqual(-1e-9);
    expect(r.final.jackpot).toBeGreaterThanOrEqual(-1e-9);
    expect(r.final.bountyPool).toBeGreaterThanOrEqual(-1e-9);
    expect(r.final.burnedTotal).toBeGreaterThanOrEqual(0);
    expect(r.final.treasuryTotal).toBeGreaterThanOrEqual(0);
  });

  it("bounty conserves $WORD: carved === paid + pool (cent-exact), every day", () => {
    const r = runSim(cfg({ bounty: true }));
    for (const d of r.days) {
      expect(Math.abs(d.bountyCarvedTotal - (d.bountyPaidTotal + d.bountyPool))).toBeLessThan(1e-6);
    }
    expect(r.final.bountyPaidTotal).toBeGreaterThan(0); // the bounty actually paid out
  });

  it("prestige engages and is sound: monotonic, capped, never decremented", () => {
    const levels = DEFAULT_PARAMS.prestige.levels;
    const r = runSim(cfg({ prestige: true }));
    expect(r.final.prestigeLevelsTotal).toBeGreaterThan(0); // upgrade-chasers ascend their maxed words
    expect(sumPrestigeAttempts(r)).toBeGreaterThan(0);
    // cap: total levels can't exceed (held words) × max level
    expect(r.final.prestigeLevelsTotal).toBeLessThanOrEqual(r.final.totalClaims * levels);
    // monotonic: with dissolution OFF words only accrue and levels are never decremented, so the
    // aggregate level count is non-decreasing day over day (the on-chain "monotonic, fail = no-op").
    for (let i = 1; i < r.days.length; i++) {
      expect(r.days[i].prestigeLevelsTotal).toBeGreaterThanOrEqual(r.days[i - 1].prestigeLevelsTotal);
    }
  });

  it("the theme bounty reaches casuals far more than yield does", () => {
    // The design thesis: yield is UPPERCASE-only (whale-skewed); the hold+feed bounty is the one
    // casual-reachable renewable goal. So casuals' share of BOUNTY should dwarf their share of YIELD.
    const r = runSim(cfg({ bounty: true }));
    const casual = r.playerRoi.find((p) => p.archetype === "casual")!;
    const totalYield = r.playerRoi.reduce((a, p) => a + p.yieldEarned, 0);
    const totalBounty = r.playerRoi.reduce((a, p) => a + p.bountyEarned, 0);
    expect(totalBounty).toBeGreaterThan(0);
    const casualBountyShare = casual.bountyEarned / totalBounty;
    const casualYieldShare = totalYield > 0 ? casual.yieldEarned / totalYield : 0;
    expect(casualBountyShare).toBeGreaterThan(0.1); // casuals get a real slice of the bounty
    expect(casualBountyShare).toBeGreaterThan(casualYieldShare); // …far more than of yield
  });
});
