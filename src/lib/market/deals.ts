/**
 * The Market's thinking (decisions.md #30; starl3xx, 2026-11-25: "Market listing should be
 * intelligent; that is, helping the user with suggested prices, comparison, etc, and directing the
 * user to the best deal *for them*"). Pure, so every number is tested (tests/market-deals.test.ts).
 *
 * Three references stand beside a price, and none of them is "what it's worth":
 * - **to make**: about what the thing costs to build today (lib/wordCost.ts: a letter is its share of
 *   a pack, an UPPERCASE letter adds the average rolls, a word adds its claim and ascension);
 * - **for sale**: the lowest price the same thing is listed at now (letters are alike, so a letter
 *   has one; a word is one of a kind, so its neighbors are the words of its rarity);
 * - **sold**: what it went for lately.
 *
 * A pick is a listing worth showing THIS player first: a letter that finishes a word their bag is one
 * letter short of, or something listed under what it costs to make.
 */
import { ALPHABET, RANKED_WORDS, TIERS, wordTier, type Tier } from "@/lib/economy";
import { costToMake, dailyEarnEstimate, letterCost, rollsPerRaise, roundPrice, type CostPrices } from "@/lib/wordCost";
import { bagTotals, distanceOf, elsewhereTotals, finishingLetter, type LetterBag } from "@/lib/wordNeed";
import type { LetterAsk, LetterBook, LetterSaleStat, TierSaleStat } from "./types";

export const TIER_RANK: Record<Tier, number> = Object.fromEntries(TIERS.map((t, i) => [t.name, i])) as Record<Tier, number>;

/** A letter id's letter (always A-Z) and case. */
export const letterOf = (letterId: number): string => ALPHABET[letterId % 26];
export const isUpperId = (letterId: number): boolean => letterId >= 26;
/** The letter as players read it: lowercase letters lowercase, raised ones UPPERCASE. */
export const letterLabel = (letterId: number): string => (isUpperId(letterId) ? letterOf(letterId) : letterOf(letterId).toLowerCase());

/** About what one of this letter costs to make: its share of a pack, plus the average rolls when it is UPPERCASE. */
export function letterMakeCost(letterId: number, prices: Pick<CostPrices, "pack" | "roll">): number {
  const base = letterCost(letterOf(letterId), prices.pack);
  return isUpperId(letterId) ? base + rollsPerRaise() * prices.roll : base;
}

/** `price` against `reference`, as a fraction: -0.12 is 12% under. Null without a usable reference. */
export function versus(price: number, reference: number | null | undefined): number | null {
  if (!reference || !(reference > 0) || !(price > 0)) return null;
  return price / reference - 1;
}

/** "12% under", "8% over", or "about the same" (within 3%). */
export function versusLabel(v: number | null): string | null {
  if (v === null) return null;
  const pct = Math.round(Math.abs(v) * 100);
  if (pct < 3) return "about the same as";
  return v < 0 ? `${pct}% under` : `${pct}% over`;
}

/** A price to offer in a sell form, and the reason it is offered. The first idea is the one to lead with. */
export interface PriceIdea {
  price: number;
  label: string;
}

/** The highest round price that is under `price`: how to be the lowest for sale without giving much away. */
export function justUnder(price: number, floor: number): number {
  let p = roundPrice(price * 0.97);
  if (p >= price) p = Math.floor(price) - 1;
  return Math.max(floor, p);
}

function dedupe(ideas: PriceIdea[]): PriceIdea[] {
  const seen = new Set<number>();
  return ideas.filter((i) => i.price > 0 && !seen.has(i.price) && seen.add(i.price));
}

/**
 * Prices to offer for a letter. With others selling the same letter, the lowest one sells first, so
 * the lead idea is to be it; then what one last sold for; then what it costs to make.
 */
export function letterPriceIdeas(a: { makeCost: number; lowestAsk?: number; stat?: LetterSaleStat; minPrice: number }): PriceIdea[] {
  const ideas: PriceIdea[] = [];
  if (a.lowestAsk && a.lowestAsk > a.minPrice) ideas.push({ price: justUnder(a.lowestAsk, a.minPrice), label: "Be the lowest for sale" });
  if (a.stat?.last) ideas.push({ price: a.stat.last, label: "What the last one sold for" });
  if (a.makeCost > 0) ideas.push({ price: Math.max(a.minPrice, roundPrice(a.makeCost)), label: "About what it costs to make" });
  return dedupe(ideas);
}

/**
 * Prices to offer for a word. A word is one of a kind, so its own cost to make leads; then what it
 * last sold for; then what its rarity's words have been going for, sold and for sale.
 */
export function wordPriceIdeas(a: { makeCost: number | null; lastSale?: number; tier: Tier; tierStat?: TierSaleStat; tierLowest?: number; minPrice: number }): PriceIdea[] {
  const ideas: PriceIdea[] = [];
  if (a.makeCost && a.makeCost > 0) ideas.push({ price: Math.max(a.minPrice, roundPrice(a.makeCost)), label: "About what it costs to make" });
  if (a.lastSale) ideas.push({ price: a.lastSale, label: "What it last sold for" });
  if (a.tierStat && a.tierStat.sales > 0) {
    ideas.push({ price: Math.max(a.minPrice, roundPrice(a.tierStat.avg)), label: `What ${a.tier} words sold for lately, on average` });
  }
  if (a.tierLowest) ideas.push({ price: a.tierLowest, label: `The lowest ${a.tier} word for sale now` });
  return dedupe(ideas);
}

// ── the letters board ──────────────────────────────────────────────────────────────────────────

export interface LetterStall {
  /** 0-25: the letter, whatever its case. */
  index: number;
  lower?: LetterBook;
  upper?: LetterBook;
  /** The lowest price of either case, and how many can be bought across the listings shown. */
  lowest?: number;
  available: number;
}

/** The 26 letters as the board draws them: each with its lowercase and UPPERCASE listings. */
export function letterStalls(book: Readonly<Record<number, LetterBook>>): LetterStall[] {
  return ALPHABET.map((_, index) => {
    const lower = book[index]?.asks.length ? book[index] : undefined;
    const upper = book[index + 26]?.asks.length ? book[index + 26] : undefined;
    const asks = [...(lower?.asks ?? []), ...(upper?.asks ?? [])];
    return {
      index,
      lower,
      upper,
      lowest: asks.length ? Math.min(...asks.map((a) => a.unitPrice)) : undefined,
      available: asks.reduce((n, a) => n + a.available, 0),
    };
  });
}

/** The lowest price a letter id is listed at by someone else (a seller's own listing isn't competition). */
export function lowestOtherAsk(book: Readonly<Record<number, LetterBook>>, letterId: number, isMine: (maker: string) => boolean): number | undefined {
  const others = (book[letterId]?.asks ?? []).filter((a) => !isMine(a.maker));
  return others.length ? Math.min(...others.map((a) => a.unitPrice)) : undefined;
}

// ── one letter short ───────────────────────────────────────────────────────────────────────────

/** Higher = rarer: the word-by-word order the Dictionary and the word view use. */
const RARITY = new Map(RANKED_WORDS.map((r) => [r.word, r.rank]));

/**
 * Rarest first, word by word, then A to Z. ONE order for every list that names "the word this
 * letter finishes": the Market's pick, the bought-letters sheet that follows the purchase
 * (sheets/BoughtLettersSheet), the Dictionary's "Only needs" filter, and the word view's "would
 * also finish". A list that sorted another way would name another word for the same letter.
 */
export const rarestFirst = (a: string, b: string): number => (RARITY.get(b) ?? 0) - (RARITY.get(a) ?? 0) || a.localeCompare(b);

/**
 * The words the player is exactly ONE letter short of, by the letter that finishes them (0-25), each
 * list rarest first. `unclaimed` is every dictionary word nobody owns. A letter of either case fills
 * the gap (a claim may mix cases), so the bag counts both.
 *
 * The counting is the Dictionary's (lib/wordNeed `finishingLetter`; decisions.md #32), so the two
 * screens never disagree about a word: `here` is the connected wallet, the only one a claim spends
 * from, and `all` is every wallet of the player. A letter the player holds in another wallet is a
 * move, never a letter to buy, so it finishes nothing here; and a word that needs a letter bought
 * AND another moved is not finished by the purchase. This used to count the connected wallet alone,
 * and offered to sell a player a letter they already held.
 */
export function oneLetterShort(here: LetterBag, all: LetterBag, unclaimed: Iterable<string>): Map<number, string[]> {
  const hereTotal = bagTotals(here);
  const elsewhere = elsewhereTotals(here, all);
  const out = new Map<number, string[]>();
  for (const word of unclaimed) {
    const letter = finishingLetter(distanceOf(word, hereTotal, elsewhere));
    if (letter >= 0) (out.get(letter) ?? out.set(letter, []).get(letter)!).push(word);
  }
  // Word by word, as the word view's "would also finish" sorts, so both name the same word first.
  for (const words of out.values()) words.sort(rarestFirst);
  return out;
}

// ── words for sale ─────────────────────────────────────────────────────────────────────────────

/** What the words list needs of a listing. */
export interface WordForSale {
  word: string;
  maker: string;
  price: number;
  upper: readonly boolean[];
  prestigeLevel: number;
  orderHash: string;
  listedAt?: string;
}

export type WordSort = "deal" | "low" | "high" | "new" | "rare";
export type CaseFilter = "all" | "upper" | "lower";

export interface WordFilter {
  /** Letters typed in the search box: the word contains them, in order. */
  q: string;
  tier: Tier | "all";
  /** "upper": every letter raised (it earns once staked). "lower": none raised. */
  cases: CaseFilter;
  /** Only what this much $WORD can buy; null to show everything. */
  within: number | null;
}

export function filterWords<T extends WordForSale>(listings: readonly T[], f: WordFilter): T[] {
  const q = f.q.trim().toUpperCase().replace(/[^A-Z]/g, "");
  return listings.filter((l) => {
    if (q && !l.word.includes(q)) return false;
    if (f.tier !== "all" && wordTier(l.word) !== f.tier) return false;
    if (f.cases === "upper" && !l.upper.every(Boolean)) return false;
    if (f.cases === "lower" && l.upper.some(Boolean)) return false;
    if (f.within !== null && l.price > f.within) return false;
    return true;
  });
}

/**
 * Sort the words. "deal" puts the lowest price against the cost to make first (a word with no known
 * cost goes last); "rare" is rarest first, then lowest price. Every sort ends on the word, so the
 * order never jitters between polls.
 */
export function sortWords<T extends WordForSale>(listings: readonly T[], sort: WordSort, makeCost: (l: T) => number | null): T[] {
  const ratio = (l: T) => versus(l.price, makeCost(l)) ?? Number.POSITIVE_INFINITY;
  const by: Record<WordSort, (a: T, b: T) => number> = {
    deal: (a, b) => ratio(a) - ratio(b),
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    new: (a, b) => (b.listedAt ?? "").localeCompare(a.listedAt ?? ""),
    rare: (a, b) => TIER_RANK[wordTier(b.word)] - TIER_RANK[wordTier(a.word)] || a.price - b.price,
  };
  return [...listings].sort((a, b) => by[sort](a, b) || a.price - b.price || a.word.localeCompare(b.word));
}

/** The lowest price among the words of one rarity that someone else is selling. */
export function tierLowest(listings: readonly WordForSale[], tier: Tier, isMine: (maker: string) => boolean, except?: string): number | undefined {
  const prices = listings.filter((l) => wordTier(l.word) === tier && !isMine(l.maker) && l.word !== except).map((l) => l.price);
  return prices.length ? Math.min(...prices) : undefined;
}

// ── picks for this player ──────────────────────────────────────────────────────────────────────

export type Deal =
  /** A letter for sale that finishes a word the bag is one letter short of. */
  | { kind: "finish"; ask: LetterAsk; word: string; alsoFinishes: number }
  /** A letter listed under what it costs to make. */
  | { kind: "letter"; ask: LetterAsk; under: number }
  /** A word listed under what it costs to make. */
  | { kind: "word"; listing: WordForSale; under: number; earns: number | null };

/** How far under the cost to make a listing must be to count as a pick. */
export const PICK_UNDER = 0.1;

/**
 * Up to `limit` listings to show this player first. In order: letters that finish a word (rarest
 * word first, one pick per letter), then whatever is furthest under its cost to make, letters and
 * words together, with at least one place kept for those. Never the player's own listings, and a
 * word only when they can pay for it.
 */
export function pickDeals(a: {
  book: Readonly<Record<number, LetterBook>>;
  words: readonly WordForSale[];
  short: ReadonlyMap<number, string[]>;
  isMine: (maker: string) => boolean;
  prices: CostPrices;
  balance: number;
  yieldToday?: { pot: number; weight: number };
  limit?: number;
}): Deal[] {
  const limit = a.limit ?? 3;
  const cheapest = (letterId: number): LetterAsk | undefined =>
    (a.book[letterId]?.asks ?? []).filter((x) => !a.isMine(x.maker) && x.available > 0).sort((x, y) => x.unitPrice - y.unitPrice)[0];

  const finish: Deal[] = [];
  for (const [index, words] of a.short) {
    // Either case finishes the word; the cheaper listing wins.
    const ask = [cheapest(index), cheapest(index + 26)].filter((x): x is LetterAsk => !!x).sort((x, y) => x.unitPrice - y.unitPrice)[0];
    if (ask && words.length > 0) finish.push({ kind: "finish", ask, word: words[0], alsoFinishes: words.length - 1 });
  }
  finish.sort((x, y) => (x.kind === "finish" && y.kind === "finish" ? TIER_RANK[wordTier(y.word)] - TIER_RANK[wordTier(x.word)] || x.ask.unitPrice - y.ask.unitPrice : 0));

  const taken = new Set(finish.map((p) => (p.kind === "finish" ? p.ask.orderHash : "")));
  const under: Deal[] = [];
  for (let letterId = 0; letterId < 52; letterId++) {
    const ask = cheapest(letterId);
    if (!ask || taken.has(ask.orderHash)) continue;
    const v = versus(ask.unitPrice, letterMakeCost(letterId, a.prices));
    if (v !== null && v <= -PICK_UNDER) under.push({ kind: "letter", ask, under: -v });
  }
  for (const listing of a.words) {
    if (a.isMine(listing.maker) || listing.price > a.balance) continue;
    const shape = { word: listing.word, upper: listing.upper, prestigeLevel: listing.prestigeLevel };
    const v = versus(listing.price, costToMake(shape, a.prices).total);
    if (v !== null && v <= -PICK_UNDER) {
      under.push({ kind: "word", listing, under: -v, earns: a.yieldToday ? dailyEarnEstimate(shape, a.yieldToday) : null });
    }
  }
  under.sort((x, y) => (x.kind !== "finish" && y.kind !== "finish" ? y.under - x.under : 0));
  // A big bag is one letter short of something with almost every letter, so the finishing letters
  // would fill every place: one is always kept for the best price under its cost, when there is one.
  return [...finish.slice(0, under.length > 0 ? Math.max(1, limit - 1) : limit), ...under].slice(0, limit);
}
