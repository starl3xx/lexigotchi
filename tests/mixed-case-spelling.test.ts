/**
 * Spelling with any mix of cases (decisions.md #16): a word's five letters may be any mix of
 * lowercase and UPPERCASE. These are the rules the Spell screen, Today's next steps, the mock game,
 * and the chain claim (Words.claim's upperMask) share.
 */
import { describe, expect, it } from "vitest";
import { canSpell, canSpellAs, caseMask, claimCase, spellableNow } from "@/components/game/state";
import { rackCases } from "@/components/game/screens/ClaimScreen";

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
