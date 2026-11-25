/**
 * Spelling with any mix of cases (decisions.md #17): a word's five letters may be any mix of
 * lowercase and UPPERCASE. These are the rules the Spell screen, Today's next steps, the mock game,
 * and the chain claim (Words.claim's upperMask) share.
 */
import { describe, expect, it } from "vitest";
import { canSpell, canSpellAs, caseMask, charToIdx, claimCase, reducer, seedState, spellableNow } from "@/components/game/state";
import { filterBag, rackCases } from "@/components/game/screens/ClaimScreen";

const counts = (letters: string) => {
  const c = Array(26).fill(0);
  for (const ch of letters) c[ch.toUpperCase().charCodeAt(0) - 65]++;
  return c;
};
const none = Array(26).fill(0);

// The tester's bag from the report: raised A, C, V, W and lowercase c, e×4, i, m×3, n, r, s×2.
const TESTER = { lower: counts("CEEEEIMMMNRSS"), upper: counts("ACVW") };

describe("spelling from both cases", () => {
  it("counts a lowercase and an UPPERCASE copy of a letter alike", () => {
    expect(canSpell("CRANE", counts("RNE"), counts("CA"))).toBe(true);
    expect(canSpell("CRANE", counts("RNE"), counts("C"))).toBe(false); // no A in either case
    expect(canSpell("EAGER", counts("EGR"), counts("AE"))).toBe(true); // two Es, one of each case
  });

  it("lets the tester's raised letters into words they couldn't spell before", () => {
    const before = spellableNow(TESTER.lower, none, new Set(), Infinity);
    const now = spellableNow(TESTER.lower, TESTER.upper, new Set(), Infinity);
    expect(now.length).toBeGreaterThan(before.length);
    // Every word the lowercase letters spelled still spells.
    expect(before.every((w) => now.includes(w))).toBe(true);
    // And some new ones need a raised letter, like CREAM or MANIC (no lowercase A).
    expect(now.some((w) => w.includes("A") && !before.includes(w))).toBe(true);
  });

  it("leaves out words already owned", () => {
    expect(spellableNow(counts("RNE"), counts("CA"), new Set(["CRANE"]), Infinity)).not.toContain("CRANE");
  });
});

describe("the case each letter is claimed in", () => {
  it("is UPPERCASE wherever the bag has one to spare (quick claim, “UPPERCASE first”)", () => {
    expect(claimCase("CRANE", counts("CA"))).toEqual([true, false, true, false, false]);
    expect(claimCase("EAGER", counts("E"))).toEqual([true, false, false, false, false]); // one raised E, used once
    expect(claimCase("CRANE", none)).toEqual([false, false, false, false, false]);
  });

  it("checks a named mix against the bag, letter by letter", () => {
    expect(canSpellAs("CRANE", [true, false, true, false, false], counts("RNE"), counts("CA"))).toBe(true);
    expect(canSpellAs("CRANE", [true, true, true, false, false], counts("RNE"), counts("CA"))).toBe(false); // no raised R
    expect(canSpellAs("EAGER", [true, false, false, true, false], counts("AGR"), counts("EE"))).toBe(true);
    expect(canSpellAs("CRANE", [true, false], counts("RNE"), counts("CA"))).toBe(false); // five cases, always
  });

  it("is Words.claim's upperMask: bit k ⇒ position k raised", () => {
    expect(caseMask([false, false, false, false, false])).toBe(0);
    expect(caseMask([true, true, true, true, true])).toBe(0x1f);
    expect(caseMask([true, false, true, false, false])).toBe(0b00101);
  });

  it("in the practice game, takes each letter from its own case and keeps the mix in the word", () => {
    // The starter bag holds lowercase A A B C D E E G I N O L R S T T U and a raised R and E.
    const s = seedState();
    expect(s.words.some((w) => w.word === "TIERS")).toBe(false);
    const cases = [false, false, true, true, false]; // t i E R s
    const after = reducer(s, { t: "claim", word: "TIERS", cases });
    const word = after.words.find((w) => w.word === "TIERS");
    expect(word?.upper).toEqual(cases);
    expect(after.upper[charToIdx("E")]).toBe(s.upper[charToIdx("E")] - 1);
    expect(after.upper[charToIdx("R")]).toBe(s.upper[charToIdx("R")] - 1);
    expect(after.lower[charToIdx("E")]).toBe(s.lower[charToIdx("E")]); // the lowercase e stays
    expect(after.lower[charToIdx("T")]).toBe(s.lower[charToIdx("T")] - 1);
    // A case the bag doesn't hold (no raised T) claims nothing.
    expect(reducer(s, { t: "claim", word: "TIERS", cases: [true, false, false, false, false] })).toBe(s);
  });

  it("from the rack, uses exactly the tiles picked", () => {
    const rack = [
      { i: 4, upper: true }, // E
      { i: 0, upper: false }, // a
      { i: 6, upper: false }, // g
      { i: 4, upper: false }, // e
      { i: 17, upper: false }, // r
    ];
    const cases = rackCases("EAGER", rack);
    expect(cases.filter(Boolean)).toHaveLength(1); // one raised E, wherever it lands
    expect(canSpellAs("EAGER", cases, counts("AGER"), counts("E"))).toBe(true);
  });
});

// starl3xx: "Spell should show all letters a player has, of every case, and then let them filter
// upper- or lower-case".
describe("the Spell screen's case filter", () => {
  const spells = (show: "all" | "lower" | "upper") => {
    const bag = filterBag(show, TESTER.lower, TESTER.upper);
    return { bag, words: spellableNow(bag.lower, bag.upper, new Set(), Infinity) };
  };

  it("All spells in any mix and claims UPPERCASE first", () => {
    const { bag, words } = spells("all");
    expect(words).toHaveLength(158);
    expect(bag.casesFor("CREAM")).toEqual([true, false, false, true, false]); // the raised C and A
  });

  it("lowercase spells from lowercase letters alone, all claimed lowercase", () => {
    const { bag, words } = spells("lower");
    expect(words).toHaveLength(40); // what the tester's Spell screen offered before
    expect(bag.upper.every((c) => c === 0)).toBe(true);
    expect(bag.casesFor("MINES")).toEqual([false, false, false, false, false]);
  });

  it("UPPERCASE spells from raised letters alone, so it lists only words born earning", () => {
    const { bag, words } = spells("upper");
    expect(words).toHaveLength(0); // A, C, V, W spell nothing on their own: the screen says so
    expect(bag.lower.every((c) => c === 0)).toBe(true);
    expect(filterBag("upper", none, counts("CRANE")).casesFor("CRANE")).toEqual([true, true, true, true, true]);
  });
});
