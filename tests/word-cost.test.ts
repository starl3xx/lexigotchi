/**
 * "Cost to make" and "earns about X a day" (lib/wordCost.ts): the reference numbers beside a word for
 * sale. The expected values here were worked out by hand from params (40% / +15 / 85% rolls; the word
 * ladder's 40/35/30/25/20% + 10 points a miss), at the USD prices (pack $1, roll $0.25, claim $0.50,
 * stage N = N × $0.50, snack $0.02), so a params change that moves them shows up here.
 */
import { describe, expect, it } from "vitest";
import { LETTER_ODDS, wordTier } from "@/lib/economy";
import { yieldWeight } from "@/lib/keeper/shares";
import {
  attemptsAtLevel,
  costToMake,
  dailyEarnEstimate,
  expectedTries,
  letterCost,
  rollsPerRaise,
  roundPrice,
  type CostPrices,
} from "@/lib/wordCost";

const USD: CostPrices = { pack: 1, roll: 0.25, claim: () => 0.5, prestigeFee: (level) => 0.5 * (level + 1), prestigeSnack: 0.02 };
const allUpper = [true, true, true, true, true];
const allLower = [false, false, false, false, false];

describe("average tries", () => {
  it("adds up the chance of still missing before each try", () => {
    expect(expectedTries(1, 0, 1)).toBe(1);
    expect(expectedTries(0.5, 0, 0.5)).toBeCloseTo(2, 9); // geometric: 1 / p
    // 40%, then 55%, 70%, 85%, 85%…: 1 + .6 + .27 + .081 + .01215 / .85
    expect(rollsPerRaise()).toBeCloseTo(1.9653, 4);
  });

  it("gets harder up the word ladder", () => {
    const tries = [0, 1, 2, 3, 4].map((l) => attemptsAtLevel(l));
    expect(tries.map((t) => Number(t.toFixed(2)))).toEqual([2.06, 2.24, 2.45, 2.68, 2.96]);
  });
});

describe("letter cost", () => {
  it("prices a pack's draws so that, on average, they're worth exactly what the pack cost", () => {
    const average = Object.entries(LETTER_ODDS).reduce((a, [ch, odds]) => a + odds * letterCost(ch, 1), 0);
    expect(average).toBeCloseTo(1 / 5, 9);
  });

  it("charges a rare letter more than a common one, by how rare it is", () => {
    expect(letterCost("q", 1) / letterCost("e", 1)).toBeCloseTo(LETTER_ODDS.E / LETTER_ODDS.Q, 9);
    expect(letterCost("Q", 1)).toBeGreaterThan(letterCost("E", 1) * 40);
  });
});

describe("costToMake", () => {
  it("counts letters, raises, the claim, and each ascension stage reached", () => {
    const c = costToMake({ word: "CRANE", upper: allUpper, prestigeLevel: 5 }, USD);
    expect(c.letters).toBeCloseTo(0.66, 2);
    expect(c.raises).toBeCloseTo(5 * 1.9653 * 0.25, 3);
    expect(c.claim).toBe(0.5);
    expect(c.ascension).toBeCloseTo(19.94, 2);
    expect(c.total).toBeCloseTo(c.letters + c.raises + c.claim + c.ascension, 9);
  });

  it("counts only what the word has now: no raises for lowercase letters, no stages it hasn't reached", () => {
    const plain = costToMake({ word: "CRANE", upper: allLower, prestigeLevel: 0 }, USD);
    expect(plain.raises).toBe(0);
    expect(plain.ascension).toBe(0);
    const two = costToMake({ word: "CRANE", upper: [true, true, false, false, false], prestigeLevel: 0 }, USD);
    expect(two.raises).toBeCloseTo(2 * rollsPerRaise() * 0.25, 9);
  });

  it("makes a word with rare letters cost more to make", () => {
    const jazzy = costToMake({ word: "JAZZY", upper: allLower, prestigeLevel: 0 }, USD);
    const tease = costToMake({ word: "TEASE", upper: allLower, prestigeLevel: 0 }, USD);
    expect(jazzy.letters).toBeGreaterThan(tease.letters * 10);
  });

  it("uses the stage's own fee for each attempt (stage N costs N × the base fee)", () => {
    const gilded1 = costToMake({ word: "CRANE", upper: allUpper, prestigeLevel: 1 }, USD);
    expect(gilded1.ascension).toBeCloseTo(attemptsAtLevel(0) * (0.5 + 0.02), 9);
  });
});

describe("dailyEarnEstimate", () => {
  it("earns nothing until all five letters are UPPERCASE", () => {
    expect(dailyEarnEstimate({ word: "CRANE", upper: [true, true, true, true, false], prestigeLevel: 0 }, { pot: 100, weight: 9 }, wordTier)).toBeNull();
  });

  it("takes its weight's share of today's pot once it joins the words sharing it", () => {
    const crane = { word: "CRANE", upper: allUpper, prestigeLevel: 0 }; // Common: weight 1
    expect(dailyEarnEstimate(crane, { pot: 100, weight: 0 }, wordTier)).toBeCloseTo(100, 9); // alone: the whole pot
    expect(dailyEarnEstimate(crane, { pot: 100, weight: 9 }, wordTier)).toBeCloseTo(10, 9);
    const gilded = dailyEarnEstimate({ ...crane, prestigeLevel: 1 }, { pot: 100, weight: 9 }, wordTier);
    expect(gilded).toBeCloseTo((100 * 1.1) / (9 + 1.1), 9);
    expect(dailyEarnEstimate(crane, { pot: 0, weight: 9 }, wordTier)).toBe(0);
  });

  it("weighs words the same way the keeper does", () => {
    const base = { word: "CRANE", staked: true, upperAll: true, prestigeLevel: 0 };
    expect(yieldWeight({ ...base, daysUnfed: 0 }, wordTier)).toBe(1);
    expect(yieldWeight({ ...base, daysUnfed: 1 }, wordTier)).toBe(0.5); // peckish: half
    expect(yieldWeight({ ...base, daysUnfed: 3 }, wordTier)).toBe(0); // hungry: nothing
    expect(yieldWeight({ ...base, daysUnfed: 0, staked: false }, wordTier)).toBe(0);
    expect(yieldWeight({ ...base, daysUnfed: 0, upperAll: false }, wordTier)).toBe(0);
  });
});

describe("roundPrice", () => {
  it("rounds to three significant figures", () => {
    expect(roundPrice(96_958_123)).toBe(97_000_000);
    expect(roundPrice(1_234_567)).toBe(1_230_000);
    expect(roundPrice(123)).toBe(123);
    expect(roundPrice(0)).toBe(0);
  });
});
