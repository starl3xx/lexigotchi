/**
 * The Today tab's "Your next steps" (src/components/game/todaySteps.ts): what a player can do now,
 * from their own bag.
 */
import { describe, it, expect } from "vitest";
import { nextSteps } from "@/components/game/todaySteps";
import type { OwnedWord } from "@/components/game/state";

const word = (w: string, o: Partial<OwnedWord> = {}): OwnedWord => ({
  word: w,
  tier: "Common",
  upper: [false, false, false, false, false],
  staked: false,
  daysUnfed: 0,
  prestigeLevel: 0,
  prestigePity: 0,
  mine: true,
  ...o,
});
const none = Array(26).fill(0);
const counts = (letters: string) => {
  const c = Array(26).fill(0);
  for (const ch of letters.toUpperCase()) c[ch.charCodeAt(0) - 65]++;
  return c;
};
const odds = (p: number) => Math.min(0.85, 0.45 + 0.1 * p);
const base = { claimables: [], lower: none, upper: none, pity: Array(26).fill(0), rollProb: odds };

describe("nextSteps", () => {
  it("an unstaked word: stake it", () => {
    const steps = nextSteps({ ...base, words: [word("AGLOW", { upper: [false, true, false, false, false] })] });
    expect(steps).toContainEqual({ kind: "stake", word: "AGLOW", earns: false });
  });

  it("a fully UPPERCASE unstaked word comes first and is marked as earning", () => {
    const steps = nextSteps({ ...base, words: [word("AGLOW"), word("CRANE", { upper: [true, true, true, true, true] })] });
    const stakes = steps.filter((s) => s.kind === "stake");
    expect(stakes[0]).toEqual({ kind: "stake", word: "CRANE", earns: true });
  });

  it("rolls the lowercase letter with the best odds in each word, staked words first", () => {
    const pity = Array(26).fill(0);
    pity["O".charCodeAt(0) - 65] = 3; // O has 75% odds, the other lowercase letters 45%
    const steps = nextSteps({
      ...base,
      pity,
      words: [word("CLAMP"), word("AGLOW", { staked: true, upper: [false, true, false, false, false] })],
    });
    const rolls = steps.filter((s) => s.kind === "roll");
    expect(rolls[0]).toMatchObject({ kind: "roll", word: "AGLOW", letter: "O", pos: 3 });
    expect(rolls[0].kind === "roll" && Math.round(rolls[0].odds * 100)).toBe(75);
    expect(rolls[1]).toMatchObject({ word: "CLAMP" });
  });

  it("never offers to roll a fully UPPERCASE word, or to act on a linked wallet's word", () => {
    const steps = nextSteps({
      ...base,
      words: [word("CRANE", { staked: true, upper: [true, true, true, true, true] }), word("PIXEL", { mine: false })],
    });
    expect(steps.some((s) => s.kind === "roll")).toBe(false);
    expect(steps.some((s) => "word" in s && s.word === "PIXEL")).toBe(false);
  });

  it("a word the loose letters spell, without offering a word already owned", () => {
    const steps = nextSteps({ ...base, words: [word("CRANE", { staked: true, upper: [true, true, true, true, true] })], lower: counts("CRANE") });
    const spells = steps.filter((s) => s.kind === "spell");
    expect(spells.length).toBeGreaterThan(0);
    expect(spells.every((s) => s.kind === "spell" && s.word !== "CRANE" && !s.upper)).toBe(true);
  });

  it("a word spellable in both cases is offered once, in UPPERCASE (Bugbot on #119)", () => {
    const steps = nextSteps({ ...base, words: [], lower: counts("CRANE"), upper: counts("CRANE") });
    const spells = steps.filter((s) => s.kind === "spell");
    const words = spells.map((s) => s.kind === "spell" && s.word);
    expect(new Set(words).size).toBe(words.length);
    expect(spells[0]).toMatchObject({ upper: true });
  });

  it("offers up to two UPPERCASE spells when the letters allow (Bugbot on #119)", () => {
    const steps = nextSteps({ ...base, words: [], upper: counts("CRANEBLAST") });
    const spells = steps.filter((s) => s.kind === "spell");
    expect(spells).toHaveLength(2);
    expect(spells.every((s) => s.kind === "spell" && s.upper)).toBe(true);
  });

  it("rewards to collect come first", () => {
    const steps = nextSteps({ ...base, words: [word("AGLOW")], claimables: [{ amount: 100 }, { amount: 50 }] });
    expect(steps[0]).toEqual({ kind: "rewards", amount: 150 });
  });

  it("an empty bag points at the start; a busy bag doesn't", () => {
    expect(nextSteps({ ...base, words: [] })).toEqual([{ kind: "start" }]);
    expect(nextSteps({ ...base, words: [], lower: counts("A") }).some((s) => s.kind === "start")).toBe(false);
  });

  it("keeps the list short", () => {
    const many = ["ABBEY", "ABBOT", "ABHOR", "ABIDE", "ABLED"].map((w) => word(w));
    const steps = nextSteps({ ...base, words: many });
    expect(steps.filter((s) => s.kind === "stake")).toHaveLength(3);
    expect(steps.filter((s) => s.kind === "roll")).toHaveLength(2);
  });

  it("doesn't call a bag empty when the letters sit in another linked wallet", () => {
    const empty26 = Array.from({ length: 26 }, () => 0);
    const base = { words: [], claimables: [], lower: empty26, upper: empty26, pity: empty26, rollProb: () => 0.1 };
    expect(nextSteps(base).map((s) => s.kind)).toEqual(["start"]);
    expect(nextSteps({ ...base, bagLetters: 7 }).map((s) => s.kind)).toEqual([]);
  });
});
