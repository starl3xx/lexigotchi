/**
 * What the Market's routes hand the game (decisions.md #29). Client and server safe: no imports.
 * Amounts are whole $WORD: the app only signs whole-$WORD prices, and the letters route refuses any
 * other, so nothing is lost in the rounding.
 */

/** One seller's open listing of one letter: how many can be bought now, and for how much each. */
export interface LetterAsk {
  orderHash: string;
  maker: string;
  /** 0-25 lowercase a-z, 26-51 UPPERCASE A-Z. */
  letterId: number;
  /** What a buyer pays for one letter, whole $WORD. */
  unitPrice: number;
  /** Letters that can be bought right now: what's unsold, capped by what the seller still holds. */
  available: number;
  listedAt: string;
}

/** A letter's side of the board: its open listings, cheapest first, and whether the list goes on. */
export interface LetterBook {
  asks: LetterAsk[];
  /** More listings of this letter exist than `asks` shows. */
  more: boolean;
}

/** One of the player's own letter listings, shown even when it can't fill right now. */
export interface MyLetterListing extends LetterAsk {
  /** How many the listing started with, and how many of those are unsold. */
  qty: number;
  unsold: number;
  /**
   * "live": on the board. "paused": nothing can be bought now (the wallet holds none of the letter,
   * or Seaport's approval is off), but it comes back by itself if that changes, at this price.
   */
  state: "live" | "paused";
}

export interface MarketSale {
  kind: "word" | "letter";
  /** A word sale. */
  word?: string;
  tier?: string;
  /** A letter sale: the letter id and how many sold. */
  letterId?: number;
  qty: number;
  /** Everything the buyer paid, and what that was for each (the same for a word), whole $WORD. */
  price: number;
  unitPrice: number;
  seller: string;
  buyer: string;
  /** When, in ms. */
  at: number;
  tx: string;
}

/** What letters of one id have sold for lately. */
export interface LetterSaleStat {
  /** The latest sale's price for one letter. */
  last: number;
  lastAt: number;
  /** The average for one letter over the last 30 days, and how many sold. */
  avg: number;
  units: number;
}

/** What words of one rarity have sold for over the last 30 days. */
export interface TierSaleStat {
  sales: number;
  avg: number;
  low: number;
  high: number;
}
