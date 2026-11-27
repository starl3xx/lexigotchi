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
 */
import { mixHex, type Finish } from "./rarityFinish";
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

// --- contrast ---------------------------------------------------------------------------------

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(x: string, y: string): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text a player must read: letters on a tile, lettering on a card. */
export const READS = 4.5;
/** A line or a mark that must be seen, not read. */
export const SHOWS = 3;

/** `color` moved toward `toward` in steps until `ok(color)`; null when it never is. */
function moved(color: string, toward: string, ok: (c: string) => boolean): string | null {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const c = mixHex(color, toward, Math.min(1, t));
    if (ok(c)) return c;
  }
  return null;
}

// --- the tile ---------------------------------------------------------------------------------

/** A tile's own face and letter ink by case (TileCharacter.tsx; tests/collab-look.test.ts holds them equal). */
export const TILE_CASE = {
  upper: { face: "#ffffff", ink: "#111827" },
  lower: { face: "#f8efdd", ink: "#2a1e1a" },
} as const;

/** How strongly the collab stock tints a tile, strongest first. The last is barely a tint: a letter reads on it over any color. */
const TINTS = [0.62, 0.5, 0.4, 0.3, 0.22, 0.14, 0.08];

/**
 * The collab stock on a TILE: the two colors as one diagonal tint over the tile's own face, in
 * place of the rarity's material. The letter keeps its own ink (it belongs to the case, as the
 * border does), so the tint is thinned until the letter reads on both cases, at both ends of the
 * tint and in its middle. The tile has no metal, facets, or foil: it is a stock, not a material.
 */
export function collabFinish(look: Pick<CollabLook, "a" | "b">): Finish {
  const mid = mixHex(look.a, look.b, 0.5);
  const stops = [look.a, mid, look.b];
  const reads = (alpha: number) =>
    (["upper", "lower"] as const).every((k) => stops.every((c) => contrast(TILE_CASE[k].ink, mixHex(TILE_CASE[k].face, c, alpha)) >= READS));
  const alpha = TINTS.find(reads) ?? TINTS[TINTS.length - 1];
  const [dark, light] = luminance(look.a) <= luminance(look.b) ? [look.a, look.b] : [look.b, look.a];
  return {
    material: "collab",
    face: stops,
    alpha,
    // the light it gives off, and the shade for what is drawn around it: from its own two colors
    glow: mixHex(light, "#ffffff", 0.45),
    deep: mixHex(dark, "#1b1714", 0.35),
    period: 9,
  };
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

/** The back's cream type (globals.css, `.cb`). */
export const BACK_TEXT = "#fdf6e3";

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
