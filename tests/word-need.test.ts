/**
 * What a player needs to spell a word (lib/wordNeed; decisions.md #31): the Dictionary's "Needs a q"
 * is a promise, so these hold when it is true: only the connected wallet's letters spell, doubles
 * are counted, a letter in another wallet is a move, and the wording is right for each case.
 */
import { describe, it, expect } from "vitest";
import { WORDS } from "@/lib/dictionary";
import { article, bagTotals, distanceOf, elsewhereTotals, nameList, needParts, needTokens, tokensText, wordNeed, type LetterBag } from "@/lib/wordNeed";
import { canSpell, claimCase } from "@/components/game/state";

const bag = (lower: string, upper = ""): LetterBag => {
  const l = new Array(26).fill(0);
  const u = new Array(26).fill(0);
  for (const c of lower.toUpperCase()) l[c.charCodeAt(0) - 65]++;
  for (const c of upper.toUpperCase()) u[c.charCodeAt(0) - 65]++;
  return { lower: l, upper: u };
};
// the practice game's seed bag (components/game/state.tsx seedState)
const PRACTICE = bag("AABCDEEGINOLRSTTU", "RE");
const line = (word: string, here: LetterBag, all?: LetterBag) => tokensText(needTokens(wordNeed(word, here, all), word, "line"));
const lead = (word: string, here: LetterBag, all?: LetterBag) => tokensText(needTokens(wordNeed(word, here, all), word, "lead"));

describe("which letters a word still needs", () => {
  it("finds the one missing letter, in its place", () => {
    const n = wordNeed("QUINT", PRACTICE);
    expect(n.letters).toEqual(["missing", "here", "here", "here", "here"]);
    expect(n.missing).toEqual(["q"]);
    expect(n.away).toEqual([]);
  });

  it("counts doubles: one o held, and BLOOD has two", () => {
    const n = wordNeed("BLOOD", PRACTICE);
    expect(n.letters).toEqual(["here", "here", "here", "missing", "here"]);
    expect(n.missing).toEqual(["o"]);
    expect(wordNeed("ABUZZ", PRACTICE).missing).toEqual(["z", "z"]);
  });

  it("claims UPPERCASE first, exactly as a claim does", () => {
    for (const w of ["ABHOR", "ABODE", "TIGER", "ERASE"]) {
      const n = wordNeed(w, PRACTICE);
      const held = n.letters.every((s) => s === "here");
      if (held) expect(n.upper, w).toEqual(claimCase(w, PRACTICE.upper));
    }
    // R is held in UPPERCASE: ABHOR's r shows raised, though its h is missing
    expect(wordNeed("ABHOR", PRACTICE).upper).toEqual([false, false, false, false, true]);
  });

  it("agrees with Spell on every word in the dictionary", () => {
    let can = 0;
    for (const w of WORDS) {
      const n = wordNeed(w, PRACTICE);
      const spellable = n.missing.length === 0 && n.away.length === 0;
      expect(spellable, w).toBe(canSpell(w, PRACTICE.lower, PRACTICE.upper));
      if (spellable) can++;
    }
    expect(can).toBeGreaterThan(0);
  });

  it("calls a letter in another of the player's wallets away, never held and never missing", () => {
    const here = bag("DEPT");
    const all = bag("DEPTH");
    const n = wordNeed("DEPTH", here, all);
    expect(n.letters).toEqual(["here", "here", "here", "here", "away"]);
    expect(n.missing).toEqual([]);
    expect(n.away).toEqual(["h"]);
    // without the other wallet's letters, the same h is simply missing
    expect(wordNeed("DEPTH", here).missing).toEqual(["h"]);
  });

  it("spends the connected wallet's letters before the other wallet's", () => {
    // one o here, one o elsewhere: BLOOD is a move away, not a mint away
    const n = wordNeed("BLOOD", bag("BLOD"), bag("BLOOD"));
    expect(n.letters).toEqual(["here", "here", "here", "away", "here"]);
  });
});

describe("the dictionary-wide distances", () => {
  it("match wordNeed's counts", () => {
    const here = bagTotals(PRACTICE);
    for (const w of ["QUINT", "BLOOD", "ABUZZ", "BINGO", "JAZZY"]) {
      const n = wordNeed(w, PRACTICE);
      expect(distanceOf(w, here, null), w).toEqual({ missing: n.missing.length, away: n.away.length });
    }
    const h = bag("DEPT");
    const all = bag("DEPTH");
    expect(distanceOf("DEPTH", bagTotals(h), elsewhereTotals(h, all))).toEqual({ missing: 0, away: 1 });
    expect(elsewhereTotals(PRACTICE, PRACTICE)).toBeNull();
  });

  it("gives the practice bag the counts the proposal showed", () => {
    const here = bagTotals(PRACTICE);
    const owned = new Set(["TEASE", "CRANE", "MOTEL", "VIVID"]);
    const by = [0, 0, 0];
    for (const w of WORDS) {
      if (owned.has(w)) continue;
      const d = distanceOf(w, here, null);
      if (d.missing < 3) by[d.missing]++;
    }
    expect(by[0]).toBeGreaterThan(0);
    expect(by[1]).toBeGreaterThan(by[0]); // more words are one letter away than spellable now
  });
});

describe("the wording", () => {
  it("says “an” before a letter whose name starts with a vowel sound", () => {
    expect("aefhilmnorsx".split("").map(article)).toEqual(new Array(12).fill("an"));
    expect("bcdgjkpqtuvwyz".split("").map(article)).toEqual(new Array(14).fill("a"));
  });

  it("writes an entry's line", () => {
    expect(line("BINGO", PRACTICE)).toBe("You can spell it");
    expect(line("QUINT", PRACTICE)).toBe("Needs a q");
    expect(line("ABHOR", PRACTICE)).toBe("Needs an h");
    expect(line("BLOOD", PRACTICE)).toBe("Needs one more o");
    expect(line("ABUZZ", PRACTICE)).toBe("Needs 2 z’s");
    expect(line("ABYSS", PRACTICE)).toBe("Needs y and s");
    expect(line("JAZZY", PRACTICE)).toBe("Needs 4 letters");
    expect(line("DEPTH", bag("DEPT"), bag("DEPTH"))).toBe("Your h is in another wallet");
  });

  it("writes the word view's first line", () => {
    expect(lead("BINGO", PRACTICE)).toBe("You have all five letters.");
    expect(lead("QUINT", PRACTICE)).toBe("You only need a q.");
    expect(lead("ABHOR", PRACTICE)).toBe("You only need an h.");
    expect(lead("BLOOD", PRACTICE)).toBe("You need one more o.");
    expect(lead("ABUZZ", PRACTICE)).toBe("You need 2 z’s.");
    expect(lead("ABYSS", PRACTICE)).toBe("You need a y and one more s.");
    expect(lead("JAZZY", PRACTICE)).toBe("You need 4 more letters.");
    expect(lead("DEPTH", bag("DEPT"), bag("DEPTH"))).toBe("Your h is in your other wallet. Move it here.");
  });

  it("says “more” when some of a doubled letter is held", () => {
    // one z held, ABUZZ needs two: one more z
    expect(line("ABUZZ", bag("ABUZ"))).toBe("Needs one more z");
    // PIZZA with a z and an extra need: three z's wanted, one held
    expect(needParts(wordNeed("ZZZAB", bag("ABZ")), "ZZZAB")).toEqual([{ letter: "z", count: 2, more: true }]);
    expect(line("ZZZAB", bag("ABZ"))).toBe("Needs 2 more z’s");
  });

  it("puts the missing letter first when a word needs a mint and a move", () => {
    // q is missing, h is in the other wallet: the line names what must be found
    expect(line("QUOTH", bag("UOT"), bag("UOTH"))).toBe("Needs a q");
  });

  it("lists up to two names, then a count", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["BURQA"])).toBe("BURQA");
    expect(nameList(["BURQA", "NIQAB"])).toBe("BURQA and NIQAB");
    expect(nameList(["BURQA", "NIQAB", "QUINT", "QUOTE"])).toBe("BURQA, NIQAB, and 2 more");
  });
});
