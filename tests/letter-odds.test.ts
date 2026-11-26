/**
 * Each letter's odds (lib/letterOdds.ts): the numbers the Mint tab shows for the whole alphabet
 * (starl3xx, 2026-11-25: "the actual odds % per letter"), and the same weights the signer draws by.
 * "Actual" is the claim under test: a sold-out letter leaves the draw, the rest rise, and what the
 * screen shows is what a draw does.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { ALPHABET, LETTER_ODDS, LETTER_SUPPLY_CAP } from "@/lib/economy";
import { LOW_SHARE, PACK_DRAWS, fmtOdds, isLow, letterOdds, letterWeights, packsPer } from "@/lib/letterOdds";

const idx = (ch: string) => ch.toUpperCase().charCodeAt(0) - 65;
const FULL = new Array<number>(26).fill(1000);
const without = (...letters: string[]) => FULL.map((n, i) => (letters.some((l) => idx(l) === i) ? 0 : n));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("letterOdds", () => {
  it("is each letter’s share of the dictionary, A to Z, adding up to 1", () => {
    const odds = letterOdds();
    expect(odds).toHaveLength(26);
    expect(sum(odds)).toBeCloseTo(1, 12);
    ALPHABET.forEach((ch, i) => expect(odds[i]).toBeCloseTo(LETTER_ODDS[ch], 12));
    // every letter open reads the same with or without a supply
    expect(letterOdds(FULL)).toEqual(odds);
  });

  it("drops a sold-out letter to 0 and raises every other letter by the same factor", () => {
    const odds = letterOdds(without("e"));
    expect(odds[idx("e")]).toBe(0);
    expect(sum(odds)).toBeCloseTo(1, 12);
    const lift = 1 / (1 - LETTER_ODDS.E);
    ALPHABET.forEach((ch, i) => i !== idx("e") && expect(odds[i]).toBeCloseTo(LETTER_ODDS[ch] * lift, 12));
  });

  it("is all zeros when nothing is left to draw (never a division by zero)", () => {
    expect(letterOdds(FULL.map(() => 0))).toEqual(new Array(26).fill(0));
  });

  it("letterWeights are the draw’s raw weights: not normalized, 0 for a sold-out letter", () => {
    const w = letterWeights(without("q", "j"));
    expect(w[idx("q")]).toBe(0);
    expect(w[idx("j")]).toBe(0);
    expect(w[idx("a")]).toBe(LETTER_ODDS.A);
    expect(sum(w)).toBeLessThan(1);
  });
});

describe("what the screen shows is what a draw does", () => {
  let drawLetters: typeof import("@/lib/onchain/signer").drawLetters;
  beforeAll(async () => {
    process.env.SIGNER_DRAW_SECRET = "letter-odds-test-secret";
    ({ drawLetters } = await import("@/lib/onchain/signer"));
  });
  const LETTERS = "0x00000000000000000000000000000000000000c1" as const;
  const N = 8000;
  const tally = (available: number[]) => {
    const seen = new Array<number>(26).fill(0);
    for (let id = 0n; id < BigInt(N); id++) seen[drawLetters(LETTERS, id, 1, available, "daily")[0]]++;
    return seen.map((n) => n / N);
  };

  it("with every letter open, each letter comes up about as often as its odds say", () => {
    const got = tally(FULL);
    const odds = letterOdds(FULL);
    // within four standard errors of a draw at that rate (the draws are fixed by the test secret)
    odds.forEach((p, i) => expect(Math.abs(got[i] - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N) + 1e-9));
  });

  it("with letters sold out, a draw never gives one, and the rest follow the raised odds", () => {
    const available = without("e", "s", "q");
    const got = tally(available);
    const odds = letterOdds(available);
    for (const l of ["e", "s", "q"]) expect(got[idx(l)]).toBe(0);
    odds.forEach((p, i) => expect(Math.abs(got[i] - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N) + 1e-9));
    // and "raised" is visible: a comes up more than its base share
    expect(got[idx("a")]).toBeGreaterThan(LETTER_ODDS.A);
  });
});

describe("how the odds read", () => {
  it("one decimal from 1% up, two below it, so the rarest letters stay apart", () => {
    expect(fmtOdds(LETTER_ODDS.E)).toBe("10.4%");
    expect(fmtOdds(LETTER_ODDS.Q)).toBe("0.20%");
    expect(fmtOdds(LETTER_ODDS.J)).toBe("0.31%");
    expect(fmtOdds(0.01)).toBe("1.0%");
    expect(new Set(["Q", "J", "X", "Z"].map((l) => fmtOdds(LETTER_ODDS[l]))).size).toBe(4);
  });

  it("about 1 pack in 100 has a q: five independent draws", () => {
    expect(PACK_DRAWS).toBe(5);
    expect(Math.round(packsPer(LETTER_ODDS.Q))).toBe(100);
    expect(packsPer(1)).toBe(1);
    expect(packsPer(0)).toBe(Infinity);
  });

  it("a letter is low at a tenth of its supply or less, and a sold-out letter is not “low”", () => {
    expect(LOW_SHARE).toBe(0.1);
    const cap = LETTER_SUPPLY_CAP.Q;
    expect(isLow(Math.floor(cap * 0.1), cap)).toBe(true);
    expect(isLow(Math.floor(cap * 0.1) + 1, cap)).toBe(false);
    expect(isLow(1, cap)).toBe(true);
    expect(isLow(0, cap)).toBe(false);
    expect(isLow(5, 0)).toBe(false);
  });
});

describe("the player docs’ odds table (docs-site/letters.mdx)", () => {
  const page = readFileSync("docs-site/letters.mdx", "utf8");
  it("lists every letter with the odds the code gives", () => {
    const cells = [...page.matchAll(/\| ([a-z]) \| ([\d.]+%) /g)].map((m) => [m[1], m[2]]);
    expect(cells.map((c) => c[0]).sort().join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    for (const [letter, odds] of cells) expect(`${letter} ${odds}`).toBe(`${letter} ${fmtOdds(LETTER_ODDS[letter.toUpperCase()])}`);
  });
  it("says how often a pack has a q, as computed", () => {
    expect(page).toContain(`about 1 pack in ${Math.round(packsPer(LETTER_ODDS.Q))} has a q`);
  });
});
