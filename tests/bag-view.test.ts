/** The Bag's filters and sorts (src/components/game/bagView.ts). */
import { describe, it, expect } from "vitest";
import { matchesWord, sortLetters, sortWords, validChoice, wordFilterCounts, WORD_FILTERS } from "@/components/game/bagView";
import type { Hunger, OwnedWord } from "@/components/game/state";

const word = (w: string, o: Partial<OwnedWord> = {}): OwnedWord => ({
  word: w, tier: "Common", upper: [false, false, false, false, false], staked: true, daysUnfed: 0,
  prestigeLevel: 0, prestigePity: 0, mine: true, ...o,
});
const UP = [true, true, true, true, true];
const hungerOf = (w: OwnedWord): Hunger => (w.daysUnfed >= 3 ? "hungry" : w.daysUnfed >= 1 ? "peckish" : "fed");
const ctx = { hungerOf, forSale: new Set(["STORE"]) };
const bag = [
  word("DOUGH", { upper: UP, tier: "Rare" }), // staked, UPPERCASE, fed: earning
  word("NOVEL", { daysUnfed: 1, tier: "Uncommon" }), // staked, peckish
  word("GRAVY", { upper: UP, daysUnfed: 4, tier: "Rare" }), // staked, hungry: not earning
  word("STORE", { staked: false }), // listed
  word("FRESH", { staked: false, tier: "Uncommon" }), // waiting
];
const names = (ws: OwnedWord[]) => ws.map((w) => w.word);

describe("filters", () => {
  it("each one picks the words it names", () => {
    const pick = (f: (typeof WORD_FILTERS)[number]) => names(bag.filter((w) => matchesWord(w, f, ctx)));
    expect(pick("all")).toHaveLength(5);
    expect(pick("staked")).toEqual(["DOUGH", "NOVEL", "GRAVY"]);
    expect(pick("unstaked")).toEqual(["FRESH"]); // a listed word has its own chip
    expect(pick("forSale")).toEqual(["STORE"]);
    expect(pick("earning")).toEqual(["DOUGH"]); // GRAVY is hungry: it earns nothing
    expect(pick("needsFood")).toEqual(["NOVEL", "GRAVY"]);
  });

  it("counts each filter for its chip", () => {
    expect(wordFilterCounts(bag, ctx)).toEqual({ all: 5, staked: 3, unstaked: 1, earning: 1, needsFood: 2, forSale: 1 });
  });
});

describe("sorts", () => {
  it("hungriest first puts staked words that need food on top, the longest unfed first", () => {
    expect(names(sortWords(bag, "hungriest", hungerOf)).slice(0, 3)).toEqual(["GRAVY", "NOVEL", "DOUGH"]);
  });

  it("rarest first, then A to Z", () => {
    expect(names(sortWords(bag, "rarest", hungerOf)).slice(0, 2)).toEqual(["DOUGH", "GRAVY"]);
    expect(names(sortWords(bag, "az", hungerOf))).toEqual(["DOUGH", "FRESH", "GRAVY", "NOVEL", "STORE"]);
  });

  it("letters A to Z, or most held first", () => {
    const xs = [{ i: 4, c: 1 }, { i: 2, c: 3 }, { i: 0, c: 3 }, { i: 1, c: 1 }];
    expect(sortLetters(xs, "az").map((x) => x.i)).toEqual([0, 1, 2, 4]);
    expect(sortLetters(xs, "most").map((x) => x.i)).toEqual([0, 2, 1, 4]); // the 3s A to Z, then the 1s
  });
});

describe("a remembered choice", () => {
  it("is used only while it's still a valid one", () => {
    expect(validChoice("rarest", ["best", "rarest"] as const, "best")).toBe("rarest");
    expect(validChoice("gone", ["best", "rarest"] as const, "best")).toBe("best");
    expect(validChoice(null, ["best", "rarest"] as const, "best")).toBe("best");
  });
});
