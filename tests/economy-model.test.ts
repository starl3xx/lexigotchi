import { describe, it, expect } from "vitest";
import {
  DEFAULT_PARAMS,
  assertSplitsValid,
  rollSuccessProbability,
  expectedRollsToSuccess,
} from "@/lib/params";
import { runSim, type SimConfig, DEFAULT_SIM_CONFIG } from "@/lib/sim/simulate";

const SMALL: SimConfig = { ...DEFAULT_SIM_CONFIG, days: 80, population: 200, rampDays: 30 };

describe("params", () => {
  it("every fee split sums to exactly 1", () => {
    expect(() => assertSplitsValid(DEFAULT_PARAMS)).not.toThrow();
  });

  it("roll odds match the v0.2 decision: 45% base, +10pp pity, cap 85%", () => {
    expect(rollSuccessProbability(0)).toBeCloseTo(0.45);
    expect(rollSuccessProbability(1)).toBeCloseTo(0.55);
    expect(rollSuccessProbability(4)).toBeCloseTo(0.85); // 0.45 + 4×0.10 = 0.85 (cap)
    expect(rollSuccessProbability(10)).toBeCloseTo(0.85); // capped
  });

  it("expected rolls per upgrade is ~1.9 (v0.2 §1.4)", () => {
    const e = expectedRollsToSuccess();
    expect(e).toBeGreaterThan(1.7);
    expect(e).toBeLessThan(2.1);
  });
});

describe("solvency by construction", () => {
  const res = runSim(SMALL);

  it("the Rewards Pool is never negative on any day", () => {
    expect(res.days.every((d) => d.pool >= -1e-6)).toBe(true);
  });

  it("the Jackpot pot is never negative on any day", () => {
    expect(res.days.every((d) => d.jackpot >= -1e-6)).toBe(true);
  });

  it("burn and treasury are monotonically non-decreasing (only ever accrue)", () => {
    for (let i = 1; i < res.days.length; i++) {
      expect(res.days[i].burnedTotal).toBeGreaterThanOrEqual(res.days[i - 1].burnedTotal - 1e-6);
      expect(res.days[i].treasuryTotal).toBeGreaterThanOrEqual(res.days[i - 1].treasuryTotal - 1e-6);
    }
  });

  it("never claims more than the 4,438-word dictionary, never mints past the supply cap", () => {
    expect(res.final.totalClaims).toBeLessThanOrEqual(4438);
    expect(res.final.lettersMintedTotal).toBeLessThanOrEqual(55467);
    expect(Object.values(res.final.capConsumption).every((c) => c <= 1 + 1e-9)).toBe(true);
  });

  it("daily yield never exceeds the pool it is drawn from (rate × balance)", () => {
    for (const d of res.days) {
      // distribution is capped at dailyRate × pool, which is ≤ pool
      expect(d.distributionToday).toBeLessThanOrEqual(
        (d.pool + d.distributionToday) * DEFAULT_PARAMS.staking.dailyDistributionRate + 1e-6,
      );
    }
  });
});

describe("determinism", () => {
  it("same (config, seed) reproduces the identical economy", () => {
    const a = runSim(SMALL);
    const b = runSim(SMALL);
    expect(a.final.pool).toBe(b.final.pool);
    expect(a.final.burnedTotal).toBe(b.final.burnedTotal);
    expect(a.final.totalClaims).toBe(b.final.totalClaims);
    expect(a.jackpotWins.length).toBe(b.jackpotWins.length);
  });
});
