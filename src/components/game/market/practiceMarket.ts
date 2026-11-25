/**
 * The practice game's Market (decisions.md #30): a small seeded stall, so the page can be tried with
 * no wallet (and pictured in the docs). Listings come from made-up players; buying moves practice
 * $WORD, letters, and words in the practice store, and the player's own listings sit there unsold,
 * because nobody else is playing.
 *
 * Pure: the store's reducer calls `practiceMarketStep`, the provider reads the views. It imports only
 * types from the store, so there is no import cycle at run time.
 */
import { wordTier } from "@/lib/economy";
import type { PublicFace } from "@/lib/profile/rules";
import type { LetterAsk, LetterBook, LetterSaleStat, MarketSale, MyLetterListing, TierSaleStat } from "@/lib/market/types";
import type { GameState, OwnedWord, WordListing } from "../state";

/** The practice player's "address": what marks a listing as theirs. */
export const PRACTICE_ME = "practice-you";

const SELLERS: Record<string, PublicFace> = {
  "practice-ada": { username: "ada", pfpUrl: null },
  "practice-bo": { username: "bo", pfpUrl: null },
  "practice-cy": { username: "cy", pfpUrl: null },
  "practice-dot": { username: "dot", pfpUrl: null },
};
export const PRACTICE_FACES: Record<string, PublicFace> = { ...SELLERS, [PRACTICE_ME]: { username: "you", pfpUrl: null } };

interface PracticeAsk extends LetterAsk {
  qty: number;
}

export interface PracticeMarket {
  words: WordListing[];
  asks: PracticeAsk[];
  sales: MarketSale[];
  next: number;
}

export type MarketAction =
  | { t: "marketBuyWord"; orderHash: string; at: number }
  | { t: "marketBuyLetters"; orderHash: string; count: number; at: number }
  | { t: "marketListWord"; word: string; price: number; at: number }
  | { t: "marketListLetters"; letterId: number; qty: number; unitPrice: number; at: number }
  | { t: "marketCancel"; orderHash: string };

const F = false;
const T = true;
const id = (ch: string, upper = false) => ch.toUpperCase().charCodeAt(0) - 65 + (upper ? 26 : 0);

/** `now` in ms. Prices sit near what the practice game's packs and rolls come to. */
export function seedPracticeMarket(now: number): PracticeMarket {
  const ago = (hours: number) => now - hours * 3_600_000;
  const iso = (hours: number) => new Date(ago(hours)).toISOString();
  let n = 0;
  const word = (w: string, maker: string, price: number, upper: boolean[], hours: number, extra: Partial<WordListing> = {}): WordListing => ({
    maker, word: w, tokenId: "0", price, priceWei: "0", upper, prestigeLevel: 0, prestigePity: 0, lastFedAt: 0,
    orderHash: `practice-w${++n}`, listedAt: iso(hours), face: SELLERS[maker], ...extra,
  });
  const ask = (letterId: number, maker: string, qty: number, unitPrice: number, hours: number): PracticeAsk => ({
    orderHash: `practice-l${++n}`, maker, letterId, unitPrice, available: qty, qty, listedAt: iso(hours),
  });
  const sold = (s: Omit<MarketSale, "at" | "tx" | "unitPrice">, hours: number): MarketSale => ({
    ...s, unitPrice: Math.floor(s.price / s.qty), at: ago(hours), tx: `practice-s${++n}`,
  });
  return {
    words: [
      word("JAZZY", "practice-ada", 310_000_000, [T, T, T, T, T], 30, { prestigeLevel: 1 }),
      word("WALTZ", "practice-bo", 64_000_000, [T, T, T, T, T], 3),
      word("QUILT", "practice-cy", 41_000_000, [T, T, F, F, F], 50, { lastSale: { price: 36_000_000, at: ago(400) } }),
      word("PIXEL", "practice-dot", 12_500_000, [F, F, F, F, F], 9),
      word("ZEBRA", "practice-ada", 23_000_000, [T, T, T, T, T], 20),
      word("GHOST", "practice-bo", 5_200_000, [F, F, F, F, F], 1),
      word("HONEY", "practice-cy", 14_800_000, [T, T, T, T, T], 70),
      word("OCEAN", "practice-dot", 2_400_000, [F, F, F, F, F], 26),
      word("TIGER", "practice-ada", 9_900_000, [T, T, T, T, T], 5),
    ],
    asks: [
      ask(id("e"), "practice-ada", 6, 250_000, 40),
      ask(id("e"), "practice-bo", 3, 320_000, 4),
      ask(id("a"), "practice-cy", 4, 380_000, 22),
      ask(id("t"), "practice-dot", 2, 420_000, 12),
      ask(id("s"), "practice-bo", 5, 400_000, 60),
      ask(id("w"), "practice-ada", 5, 1_300_000, 8),
      ask(id("w"), "practice-cy", 2, 1_650_000, 2),
      ask(id("k"), "practice-dot", 3, 2_400_000, 33),
      ask(id("v"), "practice-bo", 1, 3_100_000, 16),
      ask(id("x"), "practice-ada", 2, 9_800_000, 28),
      ask(id("j"), "practice-cy", 1, 11_000_000, 6),
      ask(id("z"), "practice-dot", 2, 7_400_000, 19),
      ask(id("q"), "practice-bo", 1, 16_000_000, 44),
      ask(id("e", true), "practice-cy", 2, 1_500_000, 10),
      ask(id("s", true), "practice-ada", 1, 2_300_000, 37),
      ask(id("z", true), "practice-bo", 1, 13_500_000, 14),
    ],
    sales: [
      sold({ kind: "letter", letterId: id("z"), qty: 1, price: 8_100_000, seller: "practice-dot", buyer: "practice-ada" }, 2),
      sold({ kind: "word", word: "LUCKY", tier: wordTier("LUCKY"), qty: 1, price: 58_000_000, seller: "practice-bo", buyer: "practice-cy" }, 5),
      sold({ kind: "letter", letterId: id("e"), qty: 4, price: 1_040_000, seller: "practice-ada", buyer: "practice-dot" }, 9),
      sold({ kind: "letter", letterId: id("w"), qty: 2, price: 2_800_000, seller: "practice-cy", buyer: "practice-bo" }, 21),
      sold({ kind: "word", word: "MANGO", tier: wordTier("MANGO"), qty: 1, price: 6_300_000, seller: "practice-dot", buyer: "practice-ada" }, 30),
      sold({ kind: "letter", letterId: id("s", true), qty: 1, price: 2_100_000, seller: "practice-bo", buyer: "practice-cy" }, 47),
      sold({ kind: "word", word: "BINGO", tier: wordTier("BINGO"), qty: 1, price: 19_500_000, seller: "practice-cy", buyer: "practice-dot" }, 70),
    ],
    next: n,
  };
}

const heldOf = (s: Pick<GameState, "lower" | "upper">, letterId: number) => (letterId >= 26 ? s.upper[letterId - 26] : s.lower[letterId]) ?? 0;

/** One step of the practice Market. Anything that can't happen (no $WORD, sold out, not yours) changes nothing. */
export function practiceMarketStep(s: GameState, a: MarketAction): GameState {
  const m = s.market;
  if (!m) return s;
  switch (a.t) {
    case "marketBuyWord": {
      const l = m.words.find((x) => x.orderHash === a.orderHash);
      if (!l || l.maker === PRACTICE_ME || s.balance < l.price || s.words.some((w) => w.word === l.word)) return s;
      const bought: OwnedWord = {
        word: l.word, tier: wordTier(l.word), upper: [...l.upper], staked: false, daysUnfed: 0,
        prestigeLevel: l.prestigeLevel, prestigePity: l.prestigePity, mine: true, since: Math.floor(a.at / 1000),
      };
      const sale: MarketSale = { kind: "word", word: l.word, tier: wordTier(l.word), qty: 1, price: l.price, unitPrice: l.price, seller: l.maker, buyer: PRACTICE_ME, at: a.at, tx: `practice-s${m.next + 1}` };
      return {
        ...s,
        balance: s.balance - l.price,
        words: [...s.words, bought],
        wordsEverHeld: s.wordsEverHeld + 1,
        market: { ...m, words: m.words.filter((x) => x !== l), sales: [sale, ...m.sales], next: m.next + 1 },
      };
    }
    case "marketBuyLetters": {
      const k = m.asks.find((x) => x.orderHash === a.orderHash);
      if (!k || k.maker === PRACTICE_ME) return s;
      const count = Math.min(Math.floor(a.count), k.available);
      const price = count * k.unitPrice;
      if (count < 1 || s.balance < price) return s;
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      if (k.letterId >= 26) upper[k.letterId - 26] += count;
      else lower[k.letterId] += count;
      const sale: MarketSale = { kind: "letter", letterId: k.letterId, qty: count, price, unitPrice: k.unitPrice, seller: k.maker, buyer: PRACTICE_ME, at: a.at, tx: `practice-s${m.next + 1}` };
      const asks = m.asks.map((x) => (x === k ? { ...x, available: x.available - count } : x)).filter((x) => x.available > 0);
      return { ...s, balance: s.balance - price, lower, upper, market: { ...m, asks, sales: [sale, ...m.sales], next: m.next + 1 } };
    }
    case "marketListWord": {
      const w = s.words.find((x) => x.word === a.word);
      if (!w || w.staked || !(a.price > 0)) return s;
      const listing: WordListing = {
        maker: PRACTICE_ME, word: w.word, tokenId: "0", price: Math.floor(a.price), priceWei: "0", upper: [...w.upper],
        prestigeLevel: w.prestigeLevel, prestigePity: w.prestigePity, lastFedAt: 0, orderHash: `practice-w${m.next + 1}`, listedAt: new Date(a.at).toISOString(),
      };
      return { ...s, market: { ...m, words: [listing, ...m.words.filter((x) => !(x.maker === PRACTICE_ME && x.word === w.word))], next: m.next + 1 } };
    }
    case "marketListLetters": {
      const qty = Math.floor(a.qty);
      if (qty < 1 || qty > heldOf(s, a.letterId) || !(a.unitPrice > 0)) return s;
      const mine: PracticeAsk = { orderHash: `practice-l${m.next + 1}`, maker: PRACTICE_ME, letterId: a.letterId, unitPrice: Math.floor(a.unitPrice), available: qty, qty, listedAt: new Date(a.at).toISOString() };
      return { ...s, market: { ...m, asks: [...m.asks.filter((x) => !(x.maker === PRACTICE_ME && x.letterId === a.letterId)), mine], next: m.next + 1 } };
    }
    case "marketCancel":
      return { ...s, market: { ...m, words: m.words.filter((x) => x.orderHash !== a.orderHash), asks: m.asks.filter((x) => x.orderHash !== a.orderHash) } };
  }
}

/** The player's own listings can only offer what the bag still holds (they may have spelled the letters since). */
function live(s: GameState, a: PracticeAsk): PracticeAsk {
  return a.maker === PRACTICE_ME ? { ...a, available: Math.min(a.available, heldOf(s, a.letterId)) } : a;
}

export function practiceLetterBook(s: GameState): Record<number, LetterBook> {
  const book: Record<number, LetterBook> = {};
  for (const a of (s.market?.asks ?? []).map((x) => live(s, x))) {
    if (a.available <= 0) continue;
    const { qty: _qty, ...ask } = a;
    (book[a.letterId] ??= { asks: [], more: false }).asks.push(ask);
  }
  for (const b of Object.values(book)) b.asks.sort((x, y) => x.unitPrice - y.unitPrice);
  return book;
}

export function practiceMyLetters(s: GameState): MyLetterListing[] {
  return (s.market?.asks ?? [])
    .filter((a) => a.maker === PRACTICE_ME)
    .map((a) => live(s, a))
    .map((a) => ({ ...a, unsold: a.qty, state: a.available > 0 ? ("live" as const) : ("paused" as const) }));
}

/** What sold, summed up the way the sales route does: per letter and per rarity. */
export function practiceStats(sales: readonly MarketSale[]): { letters: Record<number, LetterSaleStat>; tiers: Record<string, TierSaleStat> } {
  const letters: Record<number, LetterSaleStat> = {};
  const tiers: Record<string, TierSaleStat> = {};
  const paid = new Map<number, number>();
  const tierPaid = new Map<string, number>();
  for (const s of sales) {
    if (s.kind === "letter" && s.letterId !== undefined) {
      const st = (letters[s.letterId] ??= { last: s.unitPrice, lastAt: s.at, avg: 0, units: 0 });
      if (s.at > st.lastAt) [st.last, st.lastAt] = [s.unitPrice, s.at];
      st.units += s.qty;
      paid.set(s.letterId, (paid.get(s.letterId) ?? 0) + s.price);
      st.avg = Math.floor(paid.get(s.letterId)! / st.units);
    } else if (s.kind === "word" && s.tier) {
      const st = (tiers[s.tier] ??= { sales: 0, avg: 0, low: s.price, high: s.price });
      st.sales++;
      st.low = Math.min(st.low, s.price);
      st.high = Math.max(st.high, s.price);
      tierPaid.set(s.tier, (tierPaid.get(s.tier) ?? 0) + s.price);
      st.avg = Math.floor(tierPaid.get(s.tier)! / st.sales);
    }
  }
  return { letters, tiers };
}
