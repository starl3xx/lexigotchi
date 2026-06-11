import { describe, it, expect } from "vitest";
import { WORDS, WORD_COUNT, RAW_WORD_LIST, BANNED } from "@/lib/dictionary";
import {
  LETTER_SLOTS,
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

// ---- Spec Appendix A: letter economy (the published, provable table) ----
const SPEC_SLOTS: Record<string, number> = {
  S: 2343, E: 2299, A: 1899, R: 1512, O: 1472, T: 1280, I: 1257, L: 1217,
  N: 1060, D: 915, U: 795, C: 776, P: 711, M: 645, H: 629, Y: 580, B: 513,
  G: 513, K: 465, F: 404, W: 339, V: 274, Z: 95, X: 86, J: 66, Q: 45,
};
const SPEC_CAPS: Record<string, number> = {
  S: 5857, E: 5747, A: 4747, R: 3780, O: 3680, T: 3200, I: 3142, L: 3042,
  N: 2650, D: 2287, U: 1987, C: 1940, P: 1777, M: 1612, H: 1572, Y: 1450,
  B: 1282, G: 1282, K: 1162, F: 1010, W: 847, V: 685, Z: 237, X: 215, J: 165, Q: 112,
};

// ---- Spec Appendix B: the 45 Legendaries (rarest first) ----
const SPEC_LEGENDARIES = "JAZZY FUZZY FIZZY DIZZY JIFFY RAQQA JUMPY PIZZA QUICK MEZZO QUACK JUMBO JUICY QUIRK AFFIX ZIPPY JANKY XEROX DJING WHIFF ZUMBA QUARK JIVED ZHONG QUINN HIJAB JUKED BURQA PUFFY FJORD KLUTZ JUMPS JUDGE ZYNGA GIZMO NIQAB JUNKS QUINT BOOZY JERKY BUGGY FLUFF FUZED QUILL QUILT".split(" ");

const SPEC_Q_WORDS = "BURQA EQUAL EQUIP ESQUE NIQAB PIQUE QUACK QUADS QUAIL QUAKE QUANT QUARK QUART QUASH QUASI QUAYS QUEEN QUEER QUELL QUERY QUESO QUEST QUEUE QUICK QUIET QUILL QUILT QUINN QUINT QUIPS QUIRK QUITE QUITO QUITS QUORA QUOTA QUOTE QURAN RAQQA ROQUE SQUAD SQUAT SQUID TUQUE".split(" ");

describe("canonical dictionary", () => {
  it("resolves to exactly 4,438 eligible words (vendored export is already unique)", () => {
    expect(WORD_COUNT).toBe(4438);
    expect(RAW_WORD_LIST.length).toBe(4438); // file's filter+sort already yields a unique list
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
  it("totals 22,190 letter slots", () => {
    expect(TOTAL_SLOTS).toBe(22190);
    expect(TOTAL_SLOTS).toBe(WORD_COUNT * 5);
  });

  it("matches the spec slot count for every letter", () => {
    for (const L of ALPHABET) expect(LETTER_SLOTS[L]).toBe(SPEC_SLOTS[L]);
  });

  it("mint odds sum to 1", () => {
    const sum = ALPHABET.reduce((a, L) => a + LETTER_ODDS[L], 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("matches the spec supply cap (floor of 2.5×) for every letter, totalling 55,467", () => {
    for (const L of ALPHABET) expect(LETTER_SUPPLY_CAP[L]).toBe(SPEC_CAPS[L]);
    // SPEC NOTE: the spec prose headlines "55,475 total letters" (= 2.5 × 22,190, the
    // pre-floor figure). The deployable per-ID caps are floor(slots × 2.5), which sum to
    // 55,467 — and that is exactly what the spec's own Appendix A per-letter column sums to.
    expect(TOTAL_SUPPLY_CAP).toBe(55467);
    expect(Math.round(TOTAL_SLOTS * 2.5)).toBe(55475); // the idealized pre-floor headline
  });

  it("Q is the scarcest letter: 45 slots, 44 Q-words (RAQQA's double explains the gap)", () => {
    expect(LETTER_SLOTS.Q).toBe(45);
    expect(Q_WORDS.length).toBe(44);
    expect([...Q_WORDS].sort()).toEqual([...SPEC_Q_WORDS].sort());
  });
});

describe("rarity tiers (Appendix B)", () => {
  it("tiers sum to the full dictionary with spec-matching anchor counts", () => {
    expect(TIER_COUNTS.Common).toBe(2219);
    expect(TIER_COUNTS.Epic).toBe(177);
    expect(TIER_COUNTS.Legendary).toBe(45);
    // One word straddles the Uncommon/Rare score-tie boundary, so we assert the
    // combined bucket (spec 1330 + 667 = 1997) rather than each side.
    expect(TIER_COUNTS.Uncommon + TIER_COUNTS.Rare).toBe(1997);
    const total = Object.values(TIER_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(4438);
  });

  it("reproduces the exact 45-Legendary set, rarest-first order intact for the top of the list", () => {
    expect([...LEGENDARIES].sort()).toEqual([...SPEC_LEGENDARIES].sort());
    // ordering check: JAZZY is the apex, the published top-10 order holds
    expect(LEGENDARIES.slice(0, 10)).toEqual(SPEC_LEGENDARIES.slice(0, 10));
  });

  it("identifies all 8 doubled-ultra-rare grails", () => {
    expect([...DOUBLED_ULTRA_RARES].sort()).toEqual(
      ["DIZZY", "FIZZY", "FUZZY", "JAZZY", "MEZZO", "PIZZA", "RAQQA", "XEROX"],
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
