/**
 * The practice game's Market (market/practiceMarket.ts): a seeded stall where buying moves practice
 * $WORD, letters, and words, so the page can be tried, and pictured in the docs, with no wallet.
 */
import { describe, it, expect } from "vitest";
import { reducer, seedState } from "@/components/game/state";
import { PRACTICE_ME, practiceLetterBook, practiceMyLetters, practiceStats } from "@/components/game/market/practiceMarket";

const AT = 1_795_000_000_000;
const E = 4;

describe("the practice Market", () => {
  it("opens with words, letters, and sales, none of them the player's", () => {
    const s = seedState();
    expect(s.market!.words.length).toBeGreaterThan(5);
    expect(Object.keys(practiceLetterBook(s)).length).toBeGreaterThan(8);
    expect(s.market!.sales.length).toBeGreaterThan(3);
    expect(practiceMyLetters(s)).toEqual([]);
    expect(s.market!.words.some((l) => s.words.some((w) => w.word === l.word))).toBe(false);
  });

  it("lists each letter's cheapest listing first", () => {
    for (const b of Object.values(practiceLetterBook(seedState()))) {
      expect(b.asks.map((a) => a.unitPrice)).toEqual([...b.asks.map((a) => a.unitPrice)].sort((x, y) => x - y));
    }
  });

  it("buying letters spends $WORD, fills the bag, shrinks the listing, and records the sale", () => {
    const s = seedState();
    const ask = practiceLetterBook(s)[E].asks[0];
    const after = reducer(s, { t: "marketBuyLetters", orderHash: ask.orderHash, count: 2, at: AT });
    expect(after.balance).toBe(s.balance - 2 * ask.unitPrice);
    expect(after.lower[E]).toBe(s.lower[E] + 2);
    expect(practiceLetterBook(after)[E].asks.find((a) => a.orderHash === ask.orderHash)!.available).toBe(ask.available - 2);
    expect(after.market!.sales[0]).toMatchObject({ kind: "letter", letterId: E, qty: 2, price: 2 * ask.unitPrice, buyer: PRACTICE_ME });
  });

  it("buying more than is left takes what is left; buying with too little $WORD does nothing", () => {
    const s = seedState();
    const ask = practiceLetterBook(s)[E].asks[0];
    const all = reducer(s, { t: "marketBuyLetters", orderHash: ask.orderHash, count: 99, at: AT });
    expect(all.lower[E]).toBe(s.lower[E] + ask.available);
    expect(practiceLetterBook(all)[E].asks.some((a) => a.orderHash === ask.orderHash)).toBe(false);
    const broke = { ...s, balance: 10 };
    expect(reducer(broke, { t: "marketBuyLetters", orderHash: ask.orderHash, count: 1, at: AT })).toBe(broke);
  });

  it("buying a word puts it in the bag, unstaked, as it was listed", () => {
    const s = seedState();
    const l = s.market!.words.find((x) => x.price <= s.balance)!;
    const after = reducer(s, { t: "marketBuyWord", orderHash: l.orderHash, at: AT });
    expect(after.words.find((w) => w.word === l.word)).toMatchObject({ staked: false, upper: l.upper, mine: true });
    expect(after.balance).toBe(s.balance - l.price);
    expect(after.wordsEverHeld).toBe(s.wordsEverHeld + 1);
    expect(after.market!.words.some((x) => x.orderHash === l.orderHash)).toBe(false);
    expect(after.market!.sales[0]).toMatchObject({ kind: "word", word: l.word, price: l.price });
  });

  it("the player's letters list at one price per letter, and only what the bag holds can sell", () => {
    const s = seedState();
    const listed = reducer(s, { t: "marketListLetters", letterId: E, qty: 2, unitPrice: 200_000, at: AT });
    expect(practiceMyLetters(listed)).toMatchObject([{ letterId: E, qty: 2, unitPrice: 200_000, state: "live", available: 2 }]);
    expect(practiceLetterBook(listed)[E].asks[0]).toMatchObject({ maker: PRACTICE_ME, unitPrice: 200_000 });
    // A new price replaces the old listing.
    const again = reducer(listed, { t: "marketListLetters", letterId: E, qty: 1, unitPrice: 190_000, at: AT });
    expect(practiceMyLetters(again)).toHaveLength(1);
    expect(practiceMyLetters(again)[0].unitPrice).toBe(190_000);
    // More than the bag holds is refused.
    expect(reducer(s, { t: "marketListLetters", letterId: E, qty: s.lower[E] + 1, unitPrice: 1, at: AT })).toBe(s);
    // Spelled since: the listing pauses, and leaves the board.
    const gone = { ...listed, lower: listed.lower.map((n, i) => (i === E ? 0 : n)) };
    expect(practiceMyLetters(gone)[0]).toMatchObject({ state: "paused", available: 0 });
    expect(practiceLetterBook(gone)[E].asks.some((a) => a.maker === PRACTICE_ME)).toBe(false);
  });

  it("a staked word can't be listed; an unstaked one can, and comes off sale", () => {
    const s = seedState();
    const staked = s.words.find((w) => w.staked)!;
    const loose = s.words.find((w) => !w.staked)!;
    expect(reducer(s, { t: "marketListWord", word: staked.word, price: 5_000_000, at: AT })).toBe(s);
    const listed = reducer(s, { t: "marketListWord", word: loose.word, price: 5_000_000, at: AT });
    const mine = listed.market!.words.find((l) => l.maker === PRACTICE_ME)!;
    expect(mine).toMatchObject({ word: loose.word, price: 5_000_000 });
    // The player can't buy their own listing.
    expect(reducer(listed, { t: "marketBuyWord", orderHash: mine.orderHash, at: AT })).toBe(listed);
    expect(reducer(listed, { t: "marketCancel", orderHash: mine.orderHash }).market!.words.some((l) => l.maker === PRACTICE_ME)).toBe(false);
  });

  it("sums sales up the way the sales route does", () => {
    const { letters, tiers } = practiceStats([
      { kind: "letter", letterId: E, qty: 4, price: 1_000_000, unitPrice: 250_000, seller: "a", buyer: "b", at: 10, tx: "1" },
      { kind: "letter", letterId: E, qty: 1, price: 300_000, unitPrice: 300_000, seller: "a", buyer: "b", at: 20, tx: "2" },
      { kind: "word", word: "LUCKY", tier: "Legendary", qty: 1, price: 50_000_000, unitPrice: 50_000_000, seller: "a", buyer: "b", at: 5, tx: "3" },
      { kind: "word", word: "QUILT", tier: "Legendary", qty: 1, price: 30_000_000, unitPrice: 30_000_000, seller: "a", buyer: "b", at: 6, tx: "4" },
    ]);
    expect(letters[E]).toEqual({ last: 300_000, lastAt: 20, avg: 260_000, units: 5 });
    expect(tiers.Legendary).toEqual({ sales: 2, avg: 40_000_000, low: 30_000_000, high: 50_000_000 });
  });
});
