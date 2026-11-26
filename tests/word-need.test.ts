/**
 * What a player needs to spell a word (lib/wordNeed; decisions.md #31): the Dictionary's "Needs a q"
 * is a promise, so these hold when it is true: only the connected wallet's letters spell, doubles
 * are counted, a letter in another wallet is a move, and the wording is right for each case.
 */
import { describe, it, expect } from "vitest";
import { WORDS } from "@/lib/dictionary";
import {
  article, bagTotals, distanceOf, elsewhereTotals, finishTokens, finishedBy, finishingLetter, nameList, needNote, needParts, needTokens, tokensText, wordNeed,
  type LetterBag,
} from "@/lib/wordNeed";
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
      expect(distanceOf(w, here, null), w).toMatchObject({ missing: n.missing.length, away: n.away.length });
    }
    const h = bag("DEPT");
    const all = bag("DEPTH");
    expect(distanceOf("DEPTH", bagTotals(h), elsewhereTotals(h, all))).toEqual({ missing: 0, away: 1, letter: -1 });
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

describe("the one letter that finishes a word", () => {
  const z = (ch: string) => ch.toUpperCase().charCodeAt(0) - 65;
  const letterOf = (word: string, here: LetterBag, all: LetterBag = here) =>
    finishingLetter(distanceOf(word, bagTotals(here), elsewhereTotals(here, all)));

  it("names the letter when it is all the word needs", () => {
    expect(distanceOf("QUINT", bagTotals(PRACTICE), null)).toEqual({ missing: 1, away: 0, letter: z("q") });
    expect(letterOf("QUINT", PRACTICE)).toBe(z("q"));
    expect(letterOf("BLOOD", PRACTICE)).toBe(z("o")); // one o held: one more finishes it
    expect(letterOf("BINGO", PRACTICE)).toBe(-1); // it can be spelled already
    expect(letterOf("ABUZZ", PRACTICE)).toBe(-1); // two z's short
    expect(letterOf("ABYSS", PRACTICE)).toBe(-1); // a y and an s
  });

  it("never names a letter the player holds in another wallet: that is a move, not a letter to find", () => {
    // the h is in the other wallet
    expect(letterOf("DEPTH", bag("DEPT"), bag("DEPTH"))).toBe(-1);
    // the same bag with no other wallet: the h is all it needs
    expect(letterOf("DEPTH", bag("DEPT"))).toBe(z("h"));
  });

  it("never names a letter when another must be moved here too: the letter alone does not finish it", () => {
    // q is held nowhere, and the h is in the other wallet
    expect(letterOf("QUOTH", bag("UOT"), bag("UOTH"))).toBe(-1);
    expect(letterOf("QUOTH", bag("UOTH"))).toBe(z("q"));
  });

  it("agrees with wordNeed on every word in the dictionary, with a linked wallet", () => {
    const here = bag("AABCDEEGINOLRSTTU", "RE");
    const all = bag("AABCDEEGINOLRSTTUHQZ", "RE"); // an h, a q, and a z wait in another wallet
    let named = 0;
    for (const w of WORDS) {
      const n = wordNeed(w, here, all);
      const want = n.missing.length === 1 && n.away.length === 0 ? z(n.missing[0]) : -1;
      expect(letterOf(w, here, all), w).toBe(want);
      if (want >= 0) named++;
    }
    expect(named).toBeGreaterThan(0);
  });

  it("lists the words a letter finishes, by the same rule", () => {
    const none = () => false;
    const q = finishedBy("q", WORDS, PRACTICE, none);
    expect(q).toContain("QUINT");
    for (const w of q) expect(letterOf(w, PRACTICE), w).toBe(z("q"));
    expect(q).toHaveLength(WORDS.filter((w) => letterOf(w, PRACTICE) === z("q")).length);
    // a skipped word (claimed, or the one being looked at) is left out
    expect(finishedBy("q", WORDS, PRACTICE, (w) => w === "QUINT")).not.toContain("QUINT");
    // with the q waiting in another wallet, a q finishes nothing: those words want a move
    expect(finishedBy("q", WORDS, PRACTICE, none, bag("AABCDEEGINOLRSTTUQ", "RE"))).toEqual([]);
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

  it("never says “only” when a letter must be moved here too (Bugbot on #222)", () => {
    // q must be found AND the h moved: the q is not all it takes
    expect(lead("QUOTH", bag("UOT"), bag("UOTH"))).toBe("You need a q.");
    // with the h here, it is
    expect(lead("QUOTH", bag("UOTH"))).toBe("You only need a q.");
  });

  it("says “one more” for a letter the player has in another wallet, and says to move it", () => {
    // one o in the other wallet, the second o held nowhere
    const need = wordNeed("BLOOD", bag("BLD"), bag("BLOD"));
    expect(need.letters).toEqual(["here", "here", "away", "missing", "here"]);
    expect(tokensText(needTokens(need, "BLOOD", "lead"))).toBe("You need one more o.");
    expect(needNote(need, "BLOOD")).toBe("You hold 3 of its five letters here. Your o is in your other wallet: move it here too.");
  });

  it("writes the line under the first one", () => {
    const note = (word: string, here: LetterBag, all?: LetterBag, also: string[] = []) => needNote(wordNeed(word, here, all), word, also);
    // one letter short, nothing to move: what's held, and what else the letter would finish
    expect(note("QUINT", PRACTICE, PRACTICE, ["BURQA", "NIQAB"])).toBe("You hold the u, the i, the n, and the t. A q would also finish BURQA and NIQAB.");
    expect(note("ABHOR", PRACTICE)).toBe("You hold the a, the b, the o, and the r.");
    // a mint and a move: the move is always said, and "You hold" never comes out empty
    expect(note("QUOTH", bag("UOT"), bag("UOTH"))).toBe("You hold 3 of its five letters here. Your h is in your other wallet: move it here too.");
    expect(note("QUOTH", bag(""), bag("UOTH"))).toBe("None of its letters are here yet. 4 more are in your other wallet: move them here too.");
    expect(note("JAZZY", bag("BC"))).toBe("You hold none of its letters yet.");
    expect(note("ABUZZ", PRACTICE)).toBe("You hold 3 of its five letters.");
    // nothing to add when the first line says it all
    expect(note("BINGO", PRACTICE)).toBe("");
    expect(note("DEPTH", bag("DEPT"), bag("DEPTH"))).toBe("");
    for (const w of ["QUINT", "QUOTH", "JAZZY", "ABUZZ"]) expect(note(w, bag("UOT"), bag("UOTH"))).not.toMatch(/You hold \./);
  });

  it("writes the Market's line for a letter that finishes a word", () => {
    expect(tokensText(finishTokens("q", false, "QUINT"))).toBe("A q finishes QUINT");
    expect(tokensText(finishTokens("x", false, "UNBOX"))).toBe("An x finishes UNBOX");
    // "one more" only when the player already holds one
    expect(tokensText(finishTokens("o", true, "BLOOD"))).toBe("One more o finishes BLOOD");
    // an UPPERCASE letter for sale reads in its case
    expect(finishTokens("Z", false, "BLAZE")).toEqual(["A ", { letter: "Z" }, " finishes BLAZE"]);
    // the same words the Dictionary's line uses for the same word
    expect(line("BLOOD", PRACTICE)).toBe("Needs one more o");
    expect(line("QUINT", PRACTICE)).toBe("Needs a q");
  });

  it("lists up to two names, then a count", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["BURQA"])).toBe("BURQA");
    expect(nameList(["BURQA", "NIQAB"])).toBe("BURQA and NIQAB");
    expect(nameList(["BURQA", "NIQAB", "QUINT", "QUOTE"])).toBe("BURQA, NIQAB, and 2 more");
  });
});
