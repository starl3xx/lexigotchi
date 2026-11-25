import { rollSuccessProbability } from "@/lib/params";
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
const odds = (p: number) => rollSuccessProbability(p);
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
    pity["O".charCodeAt(0) - 65] = 3; // O has 85% odds, the other lowercase letters 40%
    const steps = nextSteps({
      ...base,
      pity,
      words: [word("CLAMP"), word("AGLOW", { staked: true, upper: [false, true, false, false, false] })],
    });
    const rolls = steps.filter((s) => s.kind === "roll");
    expect(rolls[0]).toMatchObject({ kind: "roll", word: "AGLOW", letter: "O", pos: 3 });
    expect(rolls[0].kind === "roll" && Math.round(rolls[0].odds * 100)).toBe(85);
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

  it("never offers a word another player owns (the world read), as the Spell screen leaves it out", () => {
    const free = nextSteps({ ...base, words: [], lower: counts("CRANE") }).filter((s) => s.kind === "spell");
    expect(free.length).toBeGreaterThan(0);
    const taken = new Set(free.map((s) => (s.kind === "spell" ? s.word : "")));
    const after = nextSteps({ ...base, words: [], lower: counts("CRANE"), taken }).filter((s) => s.kind === "spell");
    expect(after.every((s) => s.kind === "spell" && !taken.has(s.word))).toBe(true);
  });

  it("a word the loose letters spell, without offering a word already owned", () => {
    const steps = nextSteps({ ...base, words: [word("CRANE", { staked: true, upper: [true, true, true, true, true] })], lower: counts("CRANE") });
    const spells = steps.filter((s) => s.kind === "spell");
    expect(spells.length).toBeGreaterThan(0);
    expect(spells.every((s) => s.kind === "spell" && s.word !== "CRANE" && s.cases.every((up) => !up))).toBe(true);
  });

  it("a word spellable in both cases is offered once, in UPPERCASE (Bugbot on #119)", () => {
    const steps = nextSteps({ ...base, words: [], lower: counts("CRANE"), upper: counts("CRANE") });
    const spells = steps.filter((s) => s.kind === "spell");
    const words = spells.map((s) => s.kind === "spell" && s.word);
    expect(new Set(words).size).toBe(words.length);
    expect(spells[0].kind === "spell" && spells[0].cases.every(Boolean)).toBe(true);
  });

  it("offers up to two UPPERCASE spells when the letters allow (Bugbot on #119)", () => {
    const steps = nextSteps({ ...base, words: [], upper: counts("CRANEBLAST") });
    const spells = steps.filter((s) => s.kind === "spell");
    expect(spells).toHaveLength(2);
    expect(spells.every((s) => s.kind === "spell" && s.cases.every(Boolean))).toBe(true);
  });

  // decisions.md #17: a word may mix cases. One raised C and a lowercase "rane" spell CRANE, the C
  // going in UPPERCASE; words using more raised letters are offered first.
  it("offers a word spelled with a mix of cases, its raised letter going in UPPERCASE", () => {
    const spells = nextSteps({ ...base, words: [], lower: counts("RANE"), upper: counts("C") }).filter((s) => s.kind === "spell");
    expect(spells.length).toBeGreaterThan(0);
    for (const s of spells) if (s.kind === "spell") expect(s.cases).toEqual([...s.word].map((ch) => ch === "C"));
  });

  it("offers the words using the most UPPERCASE letters first", () => {
    // CRANE all raised, beside lowercase B, L, S, T: an all-UPPERCASE anagram of CRANE beats BLAST (one raised A).
    const spells = nextSteps({ ...base, words: [], lower: counts("BLST"), upper: counts("CRANE") }).filter((s) => s.kind === "spell");
    expect(spells[0].kind === "spell" && spells[0].cases.every(Boolean)).toBe(true);
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
