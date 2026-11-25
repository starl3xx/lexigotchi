import { describe, it, expect } from "vitest";
import { WORDS, WORD_COUNT, RAW_WORD_LIST, BANNED } from "@/lib/dictionary";
import {
  LETTER_SLOTS,
  DEMAND_MULTIPLE,
  TOTAL_SLOTS,
  LETTER_ODDS,
  LETTER_SUPPLY_CAP,
  TOTAL_SUPPLY_CAP,
  TIER_COUNTS,
  LEGENDARIES,
  Q_WORDS,
  DOUBLED_ULTRA_RARES,
  ALPHABET,
  stakeWeight,
} from "@/lib/economy";

// The spec's Appendix A and B tables were published for the 4,438-word dictionary. Let's Have A Word
// added 146 words in round 36 (LHAW #326, #327; no removals), and the re-vendor on 2026-11-21 moved
// the canon to 4,584. These are the same derivations, re-run on that list: a CHANGE to any value
// here means the dictionary or the formulas moved, which is exactly what this file exists to catch.

// ---- Appendix A: letter economy (re-derived for 4,584 words) ----
const SPEC_SLOTS: Record<string, number> = {
  E: 2387, S: 2378, A: 1950, R: 1554, O: 1532, T: 1327, I: 1311, L: 1269,
  N: 1091, D: 946, U: 820, C: 798, P: 731, M: 662, H: 644, Y: 614, B: 536,
  G: 531, K: 473, F: 417, W: 355, V: 287, Z: 100, X: 91, J: 70, Q: 46,
};
const SPEC_CAPS: Record<string, number> = {
  E: 7161, S: 7134, A: 5850, R: 4662, O: 4596, T: 3981, I: 3933, L: 3807,
  N: 3273, D: 2838, U: 2460, C: 2394, P: 2193, M: 1986, H: 1932, Y: 1842,
  B: 1608, G: 1593, K: 1419, F: 1251, W: 1065, V: 861, Z: 300, X: 273, J: 210, Q: 138,
};

// ---- Appendix B: the 46 Legendaries (rarest first; JAZZY is still the apex) ----
const SPEC_LEGENDARIES = "JAZZY FUZZY FIZZY DIZZY ABUZZ JIFFY RAQQA JUMPY QUICK PIZZA MEZZO QUACK JUMBO QUIRK JUICY AFFIX OXBOW ZIPPY JANKY XEROX DJING WOOZY WHIFF QUARK ZUMBA ZHONG QUINN JIVED BURQA JUKED HIJAB QUALM PUFFY KLUTZ FJORD JUMPS UNBOX NIQAB JUDGE ZYNGA JUNKS GIZMO QUINT JERKY FLUFF BUGGY".split(" ");

const SPEC_Q_WORDS = "BURQA EQUAL EQUIP ESQUE NIQAB PIQUE QUACK QUADS QUAIL QUAKE QUALM QUANT QUARK QUART QUASH QUASI QUAYS QUEEN QUEER QUELL QUERY QUESO QUEST QUEUE QUICK QUIET QUILL QUILT QUINN QUINT QUIPS QUIRK QUITE QUITO QUITS QUORA QUOTA QUOTE QURAN RAQQA ROQUE SQUAD SQUAT SQUID TUQUE".split(" ");

describe("canonical dictionary", () => {
  it("resolves to exactly 4,584 eligible words (vendored export is already unique)", () => {
    expect(WORD_COUNT).toBe(4584);
    expect(RAW_WORD_LIST.length).toBe(4584); // file's filter+sort already yields a unique list
    expect(RAW_WORD_LIST.length - WORD_COUNT).toBe(0); // our Set() is a defensive no-op here
  });

  it("removes exactly the 16 banned words", () => {
    expect(BANNED.length).toBe(16);
    for (const b of BANNED) expect(WORDS).not.toContain(b);
  });

  it("contains only 5-letter A–Z words and is sorted + unique", () => {
    expect(WORDS.every((w) => /^[A-Z]{5}$/.test(w))).toBe(true);
    expect(new Set(WORDS).size).toBe(WORD_COUNT);
    expect([...WORDS]).toEqual([...WORDS].sort());
  });
});

describe("letter economy (Appendix A)", () => {
  it("totals 22,920 letter slots", () => {
    expect(TOTAL_SLOTS).toBe(22920);
    expect(TOTAL_SLOTS).toBe(WORD_COUNT * 5);
  });

  it("matches the spec slot count for every letter", () => {
    for (const L of ALPHABET) expect(LETTER_SLOTS[L]).toBe(SPEC_SLOTS[L]);
  });

  it("mint odds sum to 1", () => {
    const sum = ALPHABET.reduce((a, L) => a + LETTER_ODDS[L], 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("matches the supply cap (3.0× the slots) for every letter, totalling 68,760", () => {
    for (const L of ALPHABET) expect(LETTER_SUPPLY_CAP[L]).toBe(SPEC_CAPS[L]);
    // decisions.md #21: 3.0×. Every slot count × 3 is a whole number, so the per-ID caps lose nothing
    // to flooring and sum to exactly 3 × 22,920. (At 2.5× they summed to 57,294; for 4,438 words at
    // 2.5×: 55,475 and 55,467.)
    expect(DEMAND_MULTIPLE).toBe(3);
    expect(TOTAL_SUPPLY_CAP).toBe(68760);
    expect(TOTAL_SLOTS * 3).toBe(68760);
  });

  it("Q is the scarcest letter: 46 slots, 45 Q-words (RAQQA's double explains the gap)", () => {
    expect(LETTER_SLOTS.Q).toBe(46);
    expect(Q_WORDS.length).toBe(45);
    expect([...Q_WORDS].sort()).toEqual([...SPEC_Q_WORDS].sort());
  });
});

describe("rarity tiers (Appendix B)", () => {
  it("tiers sum to the full dictionary at the floor(N × p) cuts", () => {
    // cuts at floor(4584 × .50/.80/.95/.99) = 2292 / 3667 / 4354 / 4538
    expect(TIER_COUNTS.Common).toBe(2292);
    expect(TIER_COUNTS.Uncommon).toBe(1375);
    expect(TIER_COUNTS.Rare).toBe(687);
    expect(TIER_COUNTS.Epic).toBe(184);
    expect(TIER_COUNTS.Legendary).toBe(46);
    const total = Object.values(TIER_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(4584);
  });

  it("reproduces the exact 46-Legendary set, rarest-first order intact for the top of the list", () => {
    expect([...LEGENDARIES].sort()).toEqual([...SPEC_LEGENDARIES].sort());
    // ordering check: JAZZY is the apex, the published top-10 order holds
    expect(LEGENDARIES.slice(0, 10)).toEqual(SPEC_LEGENDARIES.slice(0, 10));
  });

  it("identifies all 9 doubled-grail crowns (a grail letter twice; ABUZZ is new)", () => {
    expect([...DOUBLED_ULTRA_RARES].sort()).toEqual(
      ["ABUZZ", "DIZZY", "FIZZY", "FUZZY", "JAZZY", "MEZZO", "PIZZA", "RAQQA", "XEROX"],
    );
  });
});

describe("stake weight (§5.5)", () => {
  it("multiplies tier weight by case multiplier", () => {
    expect(stakeWeight("Common", "lowercase")).toBe(1);
    expect(stakeWeight("Common", "UPPERCASE")).toBe(2);
    expect(stakeWeight("Legendary", "UPPERCASE")).toBe(16); // 8 × 2 — the max single-word weight
    expect(stakeWeight("Rare", "Mixed")).toBe(3); // Mixed earns at lowercase rate
  });
});
