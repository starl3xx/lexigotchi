/**
 * A collab set's CARD LOOK, as numbers (decisions.md, "Collab sets", item 3). A collab is a look,
 * not a rarity: one shared collab stock for every collab, tinted with the set's two colors, plus
 * the set's stamp. This file turns the two colors a partner gives into every color the tile, the
 * card's front, and its back need, and it is where "check contrast for any two colors" is done.
 * Pure: nothing here draws, reads a set, or knows a partner.
 *
 * The two colors are ANY two colors (an operator types them), so nothing is drawn in them as
 * given. Each use states what must stay readable on it, and the color is moved toward the safe
 * side until that holds:
 *  - the TILE keeps its own ink (the letter's color belongs to its case), so the tint is thinned
 *    until the letter reads on it;
 *  - the card's FRAME and ribbon are printed on paper, so the ink is the darker color, darkened
 *    until it reads, and plain graphite if it never does;
 *  - the BACK is deep, with cream type, so each color is deepened until cream reads on it.
 *
 * One lookup carries a word to its look on both sides: `collabLooksOf(sets)`, a map of word →
 * look. It is what the server reads from the sets and the game from the sets answer, and it is the
 * same object the rarity layer asks "is this a collab word?" (lib/rarity.ts `CollabWords`).
 *
 * The TILE's part is in lib/rarityFinish.ts (`collabFinish`), beside the rarities' materials it
 * takes the place of; the contrast arithmetic is lib/contrast.ts.
 */
import { READS, SHOWS, contrast, luminance, mixHex, moved } from "./contrast";
import type { CollabTint } from "./rarityFinish";
import type { CardLook } from "./cardArt/looks";
import { CARD_PAPER, GRAPHITE } from "./cardArt/looks";
import type { PublicCollab } from "./sets/rules";

/** A word's collab look: whose set it is, the two colors, and the stamp. */
export interface CollabLook {
  setId: number;
  /** The partner's name, for the card's back. */
  partner: string;
  url: string | null;
  /** "#rrggbb", as the operator gave them. Never drawn as given: see the functions below. */
  a: string;
  b: string;
  /** Where the stamp is served on this site (`/api/sets/{id}/stamp?v=…`), or null when the set has none. */
  stamp: string | null;
  /**
   * A short mark for a card picture's ADDRESS (`c=`): the set and its stamp's time. A picture is
   * kept for a week at the edge, and a reveal changes a card without changing the word, so every
   * address of a collab word's card carries this, and an address without it is asked again soon.
   */
  mark: string;
}

export type CollabLooks = ReadonlyMap<string, CollabLook>;

/** No looks: before the sets answer arrives, in the practice game, on a page outside the game. */
export const NO_LOOKS: CollabLooks = new Map<string, CollabLook>();

/** The look of one revealed or released collab set, from what any visitor is told about it. */
export function lookOf(setId: number, c: PublicCollab): CollabLook {
  const v = c.stamp ? (/[?&]v=(\d+)/.exec(c.stamp)?.[1] ?? "0") : "0";
  return { setId, partner: c.partner, url: c.url, a: c.colorA, b: c.colorB, stamp: c.stamp, mark: `${setId}-${v}` };
}

/**
 * Word → look, for every word of a REVEALED or RELEASED collab set. Takes what the game is told
 * (`publicSets`), so it can't see a draft: the server calls `publicSets` on its own sets first.
 */
export function collabLooksOf(sets: readonly ({ kind: "locked" } | { kind: "revealed" | "released"; id: number; collab: PublicCollab | null; words: readonly { word: string }[] })[]): CollabLooks {
  const out = new Map<string, CollabLook>();
  for (const s of sets) {
    if (s.kind === "locked" || !s.collab) continue;
    const look = lookOf(s.id, s.collab);
    for (const w of s.words) out.set(w.word.toUpperCase(), look);
  }
  return out;
}

// --- the card's front -------------------------------------------------------------------------

/** A collab card's front: the stock card's look in the set's two colors (`tint2` is the wash's second color). */
export interface CollabCardLook extends CardLook {
  tint2: string;
}

/**
 * The frame's ink, the stock's two-color wash, the ribbon's tails, and its diamonds. The ink is
 * printed on the card's paper and letters the ribbon, so it must READ there: the darker color,
 * darkened until it does, and graphite if it never does. The tails are a pale shade the ink reads
 * on. The diamonds only have to show.
 */
export function collabCardLook(look: Pick<CollabLook, "a" | "b">): CollabCardLook {
  const [dark, light] = luminance(look.a) <= luminance(look.b) ? [look.a, look.b] : [look.b, look.a];
  const ink = moved(dark, "#1b1714", (c) => contrast(c, CARD_PAPER) >= READS) ?? GRAPHITE;
  const ground = moved(mixHex(light, "#ffffff", 0.6), "#ffffff", (c) => contrast(ink, c) >= READS) ?? "#ffffff";
  const accent = moved(light === dark ? ink : light, ink, (c) => contrast(c, CARD_PAPER) >= SHOWS) ?? ink;
  // The stock card stays grey first (cardArt/looks.ts): a wash, never a fill.
  return { ink, tint: look.a, tint2: look.b, wash: 0.6, ground, accent };
}

// --- the card's back --------------------------------------------------------------------------

/** The back's cream type (globals.css, `.cb`, --cb-text; tests/collab-look.test.ts holds them equal). */
export const BACK_TEXT = "#f7efdc";

export interface CollabBack {
  /** the back's ground, deep */
  base: string;
  /** the ground's second color, for its gradient */
  base2: string;
  /** the frame, the seal, and the holder's stamp */
  line: string;
  /** the rack's front edge */
  rack: string;
}

/**
 * The back in the partner's colorway. A back is deep so cream type and light tiles read on it
 * (cards/material.ts), so each color is deepened until the cream type reads; the frame's line is
 * the lighter color, lightened until it shows on that ground.
 */
export function collabBack(look: Pick<CollabLook, "a" | "b">): CollabBack {
  const deep = (c: string) => moved(c, "#14100d", (x) => contrast(BACK_TEXT, x) >= 7) ?? "#14100d";
  const base = deep(look.a);
  const base2 = deep(look.b);
  const darkest = luminance(base) <= luminance(base2) ? base : base2;
  const lighter = luminance(look.a) >= luminance(look.b) ? look.a : look.b;
  const line = moved(lighter, "#ffffff", (c) => contrast(c, base) >= SHOWS && contrast(c, base2) >= SHOWS) ?? BACK_TEXT;
  return { base, base2, line, rack: mixHex(darkest, "#000000", 0.25) };
}

/** The two colors a tile is given, from a word's look. */
export const tintOf = (look: Pick<CollabLook, "a" | "b">): CollabTint => ({ a: look.a, b: look.b });
