import { WORD_COUNT } from "@/lib/dictionary";
import { TOTAL_SUPPLY_CAP } from "@/lib/economy";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PARAMS,
  assertSplitsValid,
  rollSuccessProbability,
  expectedRollsToSuccess,
  prestigeSuccessProbability,
  prestigeStageFeeUsd,
} from "@/lib/params";
import { runSim, type SimConfig, DEFAULT_SIM_CONFIG } from "@/lib/sim/simulate";

const SMALL: SimConfig = { ...DEFAULT_SIM_CONFIG, days: 80, population: 200, rampDays: 30 };

describe("params", () => {
  it("every fee split sums to exactly 1", () => {
    expect(() => assertSplitsValid(DEFAULT_PARAMS)).not.toThrow();
  });

  it("every paid action splits 75 / 10 / 10 / 5 (rewards first, decisions.md #19)", () => {
    const { packMint, dailyMint, roll, claim, prestige } = DEFAULT_PARAMS.splits;
    for (const s of [packMint, dailyMint, roll, claim, prestige!]) {
      expect(s.pool).toBeCloseTo(0.75);
      expect(s.jackpot).toBeCloseTo(0.1); // decision #3's jackpot share, unchanged
      expect(s.burn).toBeCloseTo(0.1);
      expect(s.treasury).toBeCloseTo(0.05);
    }
  });

  it("snacks stay 100% burned", () => {
    expect(DEFAULT_PARAMS.splits.snack).toEqual({ pool: 0, jackpot: 0, burn: 1, treasury: 0 });
  });

  it("roll odds: 40% first try, +15pp per miss, cap 85% (decisions.md #19)", () => {
    expect(rollSuccessProbability(0)).toBeCloseTo(0.4);
    expect(rollSuccessProbability(1)).toBeCloseTo(0.55);
    expect(rollSuccessProbability(2)).toBeCloseTo(0.7);
    expect(rollSuccessProbability(3)).toBeCloseTo(0.85); // 0.40 + 3×0.15 = 0.85 (cap)
    expect(rollSuccessProbability(10)).toBeCloseTo(0.85); // capped
  });

  it("expected rolls per upgrade stays ~1.97, close to the old ~1.91", () => {
    const e = expectedRollsToSuccess();
    expect(e).toBeGreaterThan(1.95);
    expect(e).toBeLessThan(2.0);
  });

  it("the word ladder: five stages, each harder and pricier than the last", () => {
    expect(DEFAULT_PARAMS.prestige.levels).toBe(5); // Gilded 1–4 + Holographic
    const firstTry = [0, 1, 2, 3, 4].map((lvl) => prestigeSuccessProbability(0, lvl));
    [0.4, 0.35, 0.3, 0.25, 0.2].forEach((want, i) => expect(firstTry[i]).toBeCloseTo(want));
    expect(prestigeSuccessProbability(1, 4)).toBeCloseTo(0.3); // +10pp per miss on that word
    expect(prestigeSuccessProbability(9, 4)).toBeCloseTo(0.85); // capped
    // A stage-N attempt costs N × the base fee (Prestige.sol: prestigeFee × (level + 1)).
    [0.5, 1, 1.5, 2, 2.5].forEach((usd, lvl) => expect(prestigeStageFeeUsd(lvl)).toBeCloseTo(usd));
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

  it("never claims more than the dictionary, never mints past the supply cap", () => {
    expect(res.final.totalClaims).toBeLessThanOrEqual(WORD_COUNT);
    expect(res.final.lettersMintedTotal).toBeLessThanOrEqual(TOTAL_SUPPLY_CAP);
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
