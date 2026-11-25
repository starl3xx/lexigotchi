/**
 * The Market's thinking (decisions.md #28, lib/market/deals.ts): what stands beside a price, what a
 * sell form offers, how the words list narrows and sorts, and which listings a player sees first.
 */
import { describe, it, expect } from "vitest";
import { wordTier } from "@/lib/economy";
import { costToMake, letterCost, rollsPerRaise, type CostPrices } from "@/lib/wordCost";
import {
  filterWords, justUnder, letterMakeCost, letterPriceIdeas, letterStalls, lowestOtherAsk, oneLetterShort, pickDeals, sortWords, tierLowest,
  versus, versusLabel, wordPriceIdeas, type WordForSale,
} from "@/lib/market/deals";
import type { LetterAsk, LetterBook } from "@/lib/market/types";

const prices: CostPrices = { pack: 5_000_000, roll: 1_000_000, claim: 2_000_000, prestigeSnack: 100_000, prestigeFee: () => 3_000_000 };
const ask = (letterId: number, unitPrice: number, available = 1, maker = "0xseller"): LetterAsk => ({ orderHash: `h${letterId}-${unitPrice}-${maker}`, maker, letterId, unitPrice, available, listedAt: "2026-11-25T00:00:00.000Z" });
const bookOf = (...asks: LetterAsk[]): Record<number, LetterBook> => {
  const b: Record<number, LetterBook> = {};
  for (const a of asks) (b[a.letterId] ??= { asks: [], more: false }).asks.push(a);
  return b;
};
const word = (w: string, price: number, upper = [false, false, false, false, false], maker = "0xseller", listedAt = "2026-11-25T00:00:00.000Z"): WordForSale => ({ word: w, maker, price, upper, prestigeLevel: 0, orderHash: `w-${w}`, listedAt });
const nobody = () => false;
const bag = (letters: string) => {
  const lower = new Array<number>(26).fill(0);
  for (const ch of letters.toUpperCase()) lower[ch.charCodeAt(0) - 65]++;
  return lower;
};
const NONE = new Array<number>(26).fill(0);

describe("what stands beside a price", () => {
  it("a letter costs its share of a pack to make, and an UPPERCASE one adds the average rolls", () => {
    expect(letterMakeCost(25, prices)).toBeCloseTo(letterCost("Z", prices.pack));
    expect(letterMakeCost(51, prices)).toBeCloseTo(letterCost("Z", prices.pack) + rollsPerRaise() * prices.roll);
    expect(letterMakeCost(25, prices)).toBeGreaterThan(letterMakeCost(4, prices)); // a z is rarer than an e
  });

  it("compares a price with a reference, and says so", () => {
    expect(versus(880, 1000)).toBeCloseTo(-0.12);
    expect(versusLabel(versus(880, 1000))).toBe("12% under");
    expect(versusLabel(versus(1080, 1000))).toBe("8% over");
    expect(versusLabel(versus(1010, 1000))).toBe("about the same as");
    expect(versus(100, 0)).toBeNull();
    expect(versus(100, undefined)).toBeNull();
    expect(versusLabel(null)).toBeNull();
  });
});

describe("prices a sell form offers", () => {
  it("leads with being the lowest when others sell the same letter", () => {
    const ideas = letterPriceIdeas({ makeCost: 310_000, lowestAsk: 250_000, stat: { last: 260_000, lastAt: 1, avg: 255_000, units: 4 }, minPrice: 100 });
    expect(ideas.map((i) => i.label)).toEqual(["Be the lowest for sale", "What the last one sold for", "About what it costs to make"]);
    expect(ideas[0].price).toBeLessThan(250_000);
    expect(ideas[0].price).toBeGreaterThan(230_000);
    expect(ideas[1].price).toBe(260_000);
    expect(ideas[2].price).toBe(310_000);
  });

  it("offers the cost to make alone when nothing else is known, and never the same price twice", () => {
    expect(letterPriceIdeas({ makeCost: 310_000, minPrice: 100 })).toEqual([{ price: 310_000, label: "About what it costs to make" }]);
    const same = letterPriceIdeas({ makeCost: 260_000, stat: { last: 260_000, lastAt: 1, avg: 260_000, units: 1 }, minPrice: 100 });
    expect(same).toHaveLength(1);
  });

  it("never goes under the lowest price a listing may have", () => {
    expect(justUnder(101, 100)).toBe(100);
    expect(justUnder(250_000, 100)).toBeLessThan(250_000);
    expect(letterPriceIdeas({ makeCost: 40, minPrice: 100 })[0].price).toBe(100);
  });

  it("for a word, leads with its own cost to make, then its last sale and its rarity's going rates", () => {
    const ideas = wordPriceIdeas({ makeCost: 12_840_000, lastSale: 11_000_000, tier: "Rare", tierStat: { sales: 3, avg: 19_500_000, low: 9_000_000, high: 30_000_000 }, tierLowest: 12_500_000, minPrice: 1_000 });
    expect(ideas.map((i) => i.price)).toEqual([12_800_000, 11_000_000, 19_500_000, 12_500_000]);
    expect(ideas[2].label).toContain("Rare");
    expect(wordPriceIdeas({ makeCost: null, tier: "Common", tierStat: { sales: 0, avg: 0, low: 0, high: 0 }, minPrice: 1_000 })).toEqual([]);
  });
});

describe("the letters board", () => {
  const book = bookOf(ask(4, 320_000, 3, "0xb"), ask(4, 250_000, 6, "0xa"), ask(30, 1_500_000, 2, "0xc"), ask(25, 7_400_000, 2, "0xd"));

  it("draws all 26 letters, each with its lowest price of either case and how many are for sale", () => {
    const stalls = letterStalls(book);
    expect(stalls).toHaveLength(26);
    expect(stalls[4]).toMatchObject({ index: 4, lowest: 250_000, available: 11 });
    expect(stalls[4].upper?.asks).toHaveLength(1);
    expect(stalls[25]).toMatchObject({ lowest: 7_400_000, available: 2 });
    expect(stalls[0]).toMatchObject({ lowest: undefined, available: 0 });
  });

  it("a seller's own listing isn't the price to beat", () => {
    expect(lowestOtherAsk(book, 4, (m) => m === "0xa")).toBe(320_000);
    expect(lowestOtherAsk(book, 4, nobody)).toBe(250_000);
    expect(lowestOtherAsk(book, 0, nobody)).toBeUndefined();
  });
});

describe("one letter short", () => {
  it("finds the words a bag is exactly one letter short of, by the letter that finishes them", () => {
    const short = oneLetterShort(bag("blae"), NONE, ["BLAZE", "GLAZE", "CRANE", "TABLE"]);
    expect(short.get(25)).toEqual(["BLAZE"]); // needs a z
    expect(short.get(19)).toEqual(["TABLE"]); // needs a t
    expect(short.has(6)).toBe(false); // GLAZE needs g and z: two short
  });

  it("counts both cases, and a doubled letter the bag has once", () => {
    const lower = bag("jay");
    const upper = bag("z"); // an UPPERCASE Z counts too
    expect(oneLetterShort(lower, upper, ["JAZZY"]).get(25)).toEqual(["JAZZY"]); // one more z
    expect(oneLetterShort(bag("jazzy"), NONE, ["JAZZY"]).size).toBe(0); // it can be spelled: nothing is short
  });

  it("lists the rarest word first", () => {
    const words = oneLetterShort(bag("blaegcrn"), NONE, ["BLAZE", "GLAZE", "CRAZE"]).get(25)!;
    expect(words).toHaveLength(3);
    const ranks = words.map((w) => ["Common", "Uncommon", "Rare", "Legendary", "Mythic"].indexOf(wordTier(w)));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });
});

describe("the words list", () => {
  const UP = [true, true, true, true, true];
  const list = [word("OCEAN", 2_400_000), word("TIGER", 9_900_000, UP), word("JAZZY", 310_000_000, UP), word("GHOST", 5_200_000, undefined, "0xme", "2026-11-26T00:00:00.000Z")];
  const all = { q: "", tier: "all" as const, cases: "all" as const, within: null };
  const make = (l: WordForSale) => costToMake({ word: l.word, upper: l.upper, prestigeLevel: l.prestigeLevel }, prices).total;

  it("narrows by letters typed, rarity, case, and what the player can pay", () => {
    expect(filterWords(list, { ...all, q: "ig" }).map((l) => l.word)).toEqual(["TIGER"]);
    expect(filterWords(list, { ...all, q: " o-c " }).map((l) => l.word)).toEqual(["OCEAN"]);
    expect(filterWords(list, { ...all, tier: wordTier("JAZZY") }).map((l) => l.word)).toEqual(["JAZZY"]);
    expect(filterWords(list, { ...all, cases: "upper" }).map((l) => l.word)).toEqual(["TIGER", "JAZZY"]);
    expect(filterWords(list, { ...all, cases: "lower" }).map((l) => l.word)).toEqual(["OCEAN", "GHOST"]);
    expect(filterWords(list, { ...all, within: 6_000_000 }).map((l) => l.word)).toEqual(["OCEAN", "GHOST"]);
  });

  it("sorts by price, by the newest, by the rarest, and by the best deal", () => {
    expect(sortWords(list, "low", make).map((l) => l.word)).toEqual(["OCEAN", "GHOST", "TIGER", "JAZZY"]);
    expect(sortWords(list, "high", make)[0].word).toBe("JAZZY");
    expect(sortWords(list, "new", make)[0].word).toBe("GHOST");
    expect(sortWords(list, "rare", make)[0].word).toBe("JAZZY");
    const deal = sortWords(list, "deal", make);
    const ratios = deal.map((l) => l.price / make(l));
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
    // A word with no known cost goes last, never first.
    expect(sortWords(list, "deal", (l) => (l.word === "OCEAN" ? null : make(l))).at(-1)!.word).toBe("OCEAN");
  });

  it("finds the lowest price in a rarity among other sellers' words", () => {
    const tier = wordTier("OCEAN");
    const same = [word("OCEAN", 2_400_000), word("TIGER", 9_900_000), word("NOBLE", 1_000_000, undefined, "0xme")].filter((l) => wordTier(l.word) === tier);
    expect(tierLowest(same, tier, (m) => m === "0xme")).toBe(Math.min(...same.filter((l) => l.maker !== "0xme").map((l) => l.price)));
    expect(tierLowest([], tier, nobody)).toBeUndefined();
  });
});

describe("picks for this player", () => {
  const zMake = letterMakeCost(25, prices);
  const eMake = letterMakeCost(4, prices);
  const short = new Map<number, string[]>([[25, ["BLAZE", "GLAZE"]]]);
  const cheapOcean = word("OCEAN", Math.round(costToMake({ word: "OCEAN", upper: [false, false, false, false, false], prestigeLevel: 0 }, prices).total * 0.5));

  it("puts a letter that finishes a word first, at its lowest price of either case", () => {
    const book = bookOf(ask(25, Math.round(zMake * 1.2), 2, "0xa"), ask(51, Math.round(zMake * 1.1), 1, "0xb"));
    const [first] = pickDeals({ book, words: [], short, isMine: nobody, prices, balance: 1e12 });
    expect(first).toMatchObject({ kind: "finish", word: "BLAZE", alsoFinishes: 1 });
    expect(first.kind === "finish" && first.ask.letterId).toBe(51); // the UPPERCASE one is cheaper here
  });

  it("then whatever is furthest under what it costs to make, letters and words together", () => {
    const book = bookOf(ask(4, Math.round(eMake * 0.8), 5, "0xa"), ask(0, Math.round(letterMakeCost(0, prices) * 0.95), 5, "0xa"));
    const picks = pickDeals({ book, words: [cheapOcean], short: new Map(), isMine: nobody, prices, balance: 1e12 });
    expect(picks.map((p) => p.kind)).toEqual(["word", "letter"]); // 50% under, then 20% under; 5% under is no pick
    expect(picks[1].kind === "letter" && picks[1].under).toBeCloseTo(0.2, 1);
  });

  it("keeps a place for a price under cost, however many letters finish a word", () => {
    const many = new Map<number, string[]>([[25, ["BLAZE"]], [23, ["UNBOX"]], [9, ["DJING"]], [16, ["BURQA"]]]);
    const book = bookOf(ask(25, 9e6, 1), ask(23, 9e6, 1), ask(9, 9e6, 1), ask(16, 9e6, 1));
    const picks = pickDeals({ book, words: [cheapOcean], short: many, isMine: nobody, prices, balance: 1e12 });
    expect(picks).toHaveLength(3);
    expect(picks.map((p) => p.kind)).toEqual(["finish", "finish", "word"]);
    // With nothing under cost, the finishing letters take every place.
    expect(pickDeals({ book, words: [], short: many, isMine: nobody, prices, balance: 1e12 }).map((p) => p.kind)).toEqual(["finish", "finish", "finish"]);
  });

  it("never picks the player's own listing, or a word they can't pay for", () => {
    const book = bookOf(ask(25, 1_000, 1, "0xme"));
    expect(pickDeals({ book, words: [cheapOcean], short, isMine: (m) => m === "0xme", prices, balance: cheapOcean.price - 1 })).toEqual([]);
    expect(pickDeals({ book, words: [{ ...cheapOcean, maker: "0xme" }], short, isMine: (m) => m === "0xme", prices, balance: 1e12 })).toEqual([]);
  });

  it("says what an all-UPPERCASE word would earn, when today's pool is known", () => {
    const up = { ...cheapOcean, upper: [true, true, true, true, true], price: 1_000_000 };
    const [pick] = pickDeals({ book: {}, words: [up], short: new Map(), isMine: nobody, prices, balance: 1e12, yieldToday: { pot: 1_000_000, weight: 9 } });
    expect(pick.kind === "word" && pick.earns).toBeGreaterThan(0);
    const [lower] = pickDeals({ book: {}, words: [cheapOcean], short: new Map(), isMine: nobody, prices, balance: 1e12, yieldToday: { pot: 1_000_000, weight: 9 } });
    expect(lower.kind === "word" && lower.earns).toBeNull();
  });
});
