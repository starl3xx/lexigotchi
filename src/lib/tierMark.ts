/**
 * Each rarity's mark (decisions.md #28): a round bead for Common, then a cut stone with one more
 * corner per tier: three for Uncommon, four for Rare, five for Legendary, six for Mythic.
 *
 * - **One rule orders them:** count the corners. (Riftbound and Lorcana rank their cards the same way.)
 * - **Every tier has its own outline,** so the mark still tells the tiers apart in one ink, at
 *   12 px, and for a player who can't tell teal from blue. The cube it replaces was one outline in
 *   five colours.
 * - **None is a shape the game already uses:** the star and the tilted diamonds are ascension, the
 *   crown a raised letter, the sparkle Mint. Rare's square stands upright; the pips are tilted.
 * - **Common is plain, not poor:** a polished wooden bead, drawn with the same layers as the rest.
 *
 * Pure data, shared by the game's `TierMark` and the server-drawn back picture
 * (app/s/[text]/back), so the two can't drift. Each mark is three flat paths in a 20×20 box: a
 * base in the tier's colour inside the ink line, a light (a stone's table, the bead's shine), and a
 * shade (the facets turned from the light, which comes from the upper left). No gradients, filters,
 * text, or motion: nothing here costs a frame, and Satori draws the paths as they stand.
 */
import type { Tier } from "./economy";

export type MarkPart = "base" | "light" | "shade";
export interface MarkLayer {
  part: MarkPart;
  d: string;
  /** a light's or a shade's strength, when not the usual */
  opacity?: number;
}

/** How many corners each tier's mark has: the order, as a number. */
export const TIER_MARK_CORNERS: Record<Tier, number> = { Common: 0, Uncommon: 3, Rare: 4, Legendary: 5, Mythic: 6 };

/** The mark's colour: the card back's own (globals.css `.m-*`), with Common warmed from grey-beige to wood. */
export const TIER_MARK_COLOR: Record<Tier, string> = {
  Common: "#c79c63",
  Uncommon: "#5cc4a9",
  Rare: "#6e9fe0",
  Legendary: "#f0b53a",
  Mythic: "#a77ce8",
};

export const TIER_MARK_INK = "#231a14";
const LIGHT = 0.55;
const SHADE = 0.2;

export const TIER_MARK: Record<Tier, MarkLayer[]> = {
  // a round bead: a shine on its shoulder, a shadow under its far side
  Common: [
    { part: "base", d: "M10 1.7 A8.3 8.3 0 1 1 10 18.3 A8.3 8.3 0 1 1 10 1.7 Z" },
    { part: "light", d: "M5.2 8.9 A5.4 5.4 0 0 1 9.4 4.7 C10.4 4.5 10.6 5.7 9.7 6 A4.1 4.1 0 0 0 6.5 9.2 C6.2 10.2 5 9.9 5.2 8.9 Z" },
    { part: "shade", d: "M16.8 5.24 A8.3 8.3 0 0 1 5.24 16.8 A10.5 10.5 0 0 0 16.8 5.24 Z" },
  ],
  // three corners
  Uncommon: [
    { part: "base", d: "M10 2.2 L18.4 16.6 L1.6 16.6 Z" },
    { part: "light", d: "M10 7.38 L13.86 14.01 L6.14 14.01 Z", opacity: 0.5 },
    { part: "shade", d: "M10 2.2 L18.4 16.6 L13.86 14.01 L10 7.38 Z M18.4 16.6 L1.6 16.6 L6.14 14.01 L13.86 14.01 Z" },
  ],
  // four corners, upright
  Rare: [
    { part: "base", d: "M2.6 2.6 L17.4 2.6 L17.4 17.4 L2.6 17.4 Z" },
    { part: "light", d: "M6.3 6.3 L13.7 6.3 L13.7 13.7 L6.3 13.7 Z", opacity: 0.5 },
    { part: "shade", d: "M17.4 2.6 L17.4 17.4 L13.7 13.7 L13.7 6.3 Z M17.4 17.4 L2.6 17.4 L6.3 13.7 L13.7 13.7 Z" },
  ],
  // five corners
  Legendary: [
    { part: "base", d: "M10 1.6 L18.46 7.75 L15.23 17.7 L4.77 17.7 L1.54 7.75 Z" },
    { part: "light", d: "M10 5.87 L14.4 9.07 L12.72 14.24 L7.28 14.24 L5.6 9.07 Z", opacity: 0.5 },
    { part: "shade", d: "M18.46 7.75 L15.23 17.7 L12.72 14.24 L14.4 9.07 Z M15.23 17.7 L4.77 17.7 L7.28 14.24 L12.72 14.24 Z" },
  ],
  // six corners
  Mythic: [
    { part: "base", d: "M10 1.2 L17.62 5.6 L17.62 14.4 L10 18.8 L2.38 14.4 L2.38 5.6 Z" },
    { part: "light", d: "M10 5.25 L14.12 7.62 L14.12 12.38 L10 14.75 L5.88 12.38 L5.88 7.62 Z", opacity: 0.5 },
    { part: "shade", d: "M17.62 5.6 L17.62 14.4 L14.12 12.38 L14.12 7.62 Z M17.62 14.4 L10 18.8 L10 14.75 L14.12 12.38 Z M10 18.8 L2.38 14.4 L5.88 12.38 L10 14.75 Z" },
  ],
};

/** One path of a mark, every attribute spelled out. */
export interface MarkPath {
  d: string;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
}

/**
 * A tier's mark as paths ready to draw, in order. Every attribute has a real value, because Satori
 * (the back picture) writes a missing one as the text "undefined".
 */
export function tierMarkPaths(tier: Tier): MarkPath[] {
  return TIER_MARK[tier].map((l) =>
    l.part === "base"
      ? { d: l.d, fill: TIER_MARK_COLOR[tier], opacity: 1, stroke: TIER_MARK_INK, strokeWidth: 1.2 }
      : { d: l.d, fill: l.part === "light" ? "#ffffff" : "#000000", opacity: l.opacity ?? (l.part === "light" ? LIGHT : SHADE), stroke: "none", strokeWidth: 0 },
  );
}
