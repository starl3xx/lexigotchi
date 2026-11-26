/**
 * The plastic case (decisions.md #42): a clear slab around a word's card, as graded cards are kept,
 * sold in the Shop (starl3xx, 2026-11-25: "a plastic case (like PSA-rated cards)... should be able
 * to rotate like the card does now"; then "the plastic case is SO COOL").
 *
 * **One case holds one word.** A profile may have as many words in cases as it has bought cases
 * (the wardrobe counts purchases). Taking a word out of its case frees the case for another word,
 * and a case comes off a word that leaves the profile, like its scene. A case shows only while the
 * profile still has the purchase (`casesShown`), as a Shop scene does. This is my reading, not
 * the owner's word: it is the strict one, and it can be loosened later (one purchase for every
 * word) without taking anything from anyone who bought. The other way round could not.
 *
 * Pure, so the money rule is tested.
 */
import { availability, type ItemMeta, type RegistryItem } from "./rules";

/** The one style of case there is. A word's stored case names its style, so another can follow. */
export const CASE_STYLE = "slab";

/** Whether a Shop item is a case: its `shop_items` row says so. Nothing else is. */
export function isCaseItem(meta: ItemMeta | null | undefined): boolean {
  return !!meta && meta.kind === "case";
}

/** How many cases a wardrobe holds: `owned` is item id → how many the profile has bought. */
export function casesBought(owned: ReadonlyMap<number, number>, metaOf: (itemId: number) => ItemMeta | null | undefined): number {
  let n = 0;
  for (const [itemId, count] of owned) if (count > 0 && isCaseItem(metaOf(itemId))) n += count;
  return n;
}

/** How many cases are free: bought, less the words already in one. Never below zero. */
export function casesLeft(bought: number, casedWords: number): number {
  return Math.max(0, bought - casedWords);
}

/**
 * Whether `word` may go into a case now: it is in one already (nothing changes), or a case is free.
 * `cased` is every word of the profile that is in a case.
 */
export function mayCase(word: string, cased: ReadonlySet<string>, bought: number): boolean {
  return cased.has(word) || cased.size < bought;
}

/** The case that can be bought right now (the cheapest, when two items sell one), or null. */
export function caseOnSale<T extends RegistryItem>(items: readonly T[], metaOf: (itemId: number) => ItemMeta | null | undefined, nowSec: number): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (!isCaseItem(metaOf(item.id)) || availability(item, nowSec) !== "on_sale") continue;
    if (!best || item.priceUsdc < best.priceUsdc) best = item;
  }
  return best;
}

/**
 * The words that SHOW a case, of the words the server lists (`held`: word → when it went in).
 * All of them while the count isn't known (unknown is not "no": a failed read must not take a
 * buyer's case off their card). Once it is known, at most as many as the profile has bought, the
 * oldest first: a case outlives nothing. If the wallet that bought it leaves the profile, the
 * newest cased words stop showing one (their rows stay, and still count as cases in use, until
 * the player takes a word out).
 */
export function casesShown(held: ReadonlyMap<string, number>, bought: number | null): Map<string, number> {
  if (bought === null || held.size <= bought) return new Map(held);
  const oldest = [...held].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  return new Map(oldest.slice(0, Math.max(0, bought)));
}

/** What the game knows about one player's cases, from three reads that may each be missing. */
export interface CasesState<T> {
  /** Every word the server lists in a case and when it went in, or null while that isn't known. */
  held: ReadonlyMap<string, number> | null;
  /** The words that show a case (`casesShown`). Empty while the list isn't known. */
  shown: ReadonlyMap<string, number>;
  /** How many cases the profile has bought, or null while that isn't known. */
  bought: number | null;
  /** How many are free, or null unless the list AND the count are both known. */
  left: number | null;
  /** A case that can be bought now, or null. */
  onSale: T | null;
}

/**
 * Put the three reads together (pure, tested):
 * - `list`: the server's list of cased words. Undefined while loading, null when it failed.
 * - `shop`: the Shop's items. Missing, or `metaKnown` false (it couldn't say what its items are),
 *   means no case is known of: nothing is counted or offered.
 * - `wardrobe`: item id → how many the profile bought. Missing means the count isn't known.
 * **A read that is missing is never read as zero.** An unknown list is not "no words in cases"
 * (the game would offer a case the server then refuses), and an unknown count is not "no cases".
 */
export function casesState<T extends RegistryItem & { meta: ItemMeta | null }>(a: {
  list: ReadonlyMap<string, number> | null | undefined;
  shop: { paused: boolean; metaKnown: boolean; items: readonly T[] } | null | undefined;
  wardrobe: ReadonlyMap<number, number> | null | undefined;
  nowSec: number;
}): CasesState<T> {
  const shop = a.shop && a.shop.metaKnown ? a.shop : null;
  const metaOf = (id: number) => shop?.items.find((it) => it.id === id)?.meta ?? null;
  const bought = shop && a.wardrobe ? casesBought(a.wardrobe, metaOf) : null;
  const held = a.list ?? null;
  return {
    held,
    shown: held ? casesShown(held, bought) : new Map(),
    bought,
    left: held && bought !== null ? casesLeft(bought, held.size) : null,
    onSale: shop && !shop.paused ? caseOnSale(shop.items, metaOf, a.nowSec) : null,
  };
}

/** What the Case button under an opened word offers. "none": there is no button. */
export type CaseOffer =
  | { kind: "none" }
  /** This word shows a case: it can be taken out. */
  | { kind: "cased" }
  /** A case is free: this word can go in. */
  | { kind: "put"; free: number }
  /** Every case holds a word: these can be taken out. `more`: another case can be bought now. */
  | { kind: "full"; holding: string[]; more: boolean }
  /** The profile has no case, and one can be bought now. */
  | { kind: "buy" };

/**
 * What to offer for one word (pure, tested). **Nothing on a guess:** while the list or the count
 * isn't known there is no offer to put a word in, and nothing is sold. A word that shows a case
 * can always be taken out (that needs no count).
 */
export function caseOffer(word: string, s: CasesState<unknown>): CaseOffer {
  if (!s.held) return { kind: "none" };
  if (s.shown.has(word)) return { kind: "cased" };
  if (s.bought === null || s.left === null) return { kind: "none" };
  if (s.left > 0) return { kind: "put", free: s.left };
  if (s.bought > 0) return { kind: "full", holding: [...s.shown.keys()], more: s.onSale !== null };
  return s.onSale !== null ? { kind: "buy" } : { kind: "none" };
}
