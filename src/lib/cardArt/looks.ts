/**
 * A card's look by rarity, and the card's own measures (decisions.md #34).
 *
 * The rarity is an overtone, not the whole card: the frame's border and lettering are printed in
 * its ink, and the stock card's grey engraving carries a wash of its tint. The tile finishes
 * (lib/rarityFinish) keep doing what they do on the letters.
 */
import type { Tier } from "../economy";
import { CARD_H } from "./engrave";

export interface CardLook {
  /** the frame's border and lettering */
  ink: string;
  /** the rarity's colour as a wash over grey */
  tint: string;
  /**
   * How strong that wash is. Not one number for all: a green reads far stronger than a brown or a
   * gold at the same strength, and the stock card must stay grey first (starl3xx, 2026-11-25:
   * "green stock background is still too saturated").
   */
  wash: number;
  /** a pale shade, for the ribbon's folded tails */
  ground: string;
  /** the small diamonds between the ribbon's words */
  accent: string;
}

export const CARD_LOOKS: Record<Tier, CardLook> = {
  Common: { ink: "#4a3a2c", tint: "#b99468", wash: 0.9, ground: "#e6d5b0", accent: "#b07d20" },
  Uncommon: { ink: "#1c6654", tint: "#6b9f8f", wash: 0.42, ground: "#c9e6da", accent: "#b07d20" },
  Rare: { ink: "#234f92", tint: "#5b8fdc", wash: 0.72, ground: "#c8d8f4", accent: "#b07d20" },
  Legendary: { ink: "#7a5410", tint: "#e0ad38", wash: 0.9, ground: "#f1d98a", accent: "#b8431c" },
  Mythic: { ink: "#4a2a8a", tint: "#9a78e6", wash: 0.72, ground: "#d9c8f6", accent: "#b03a7e" },
};

/** The stock card's engraving ink and paper: grey, so the rarity reads as an overtone. */
export const GRAPHITE = "#3a3734";
export const NEUTRAL = { field: "#f1efea", floor: "#e9e6df" };
/** The card's own paper, a shade lighter than the game's page. */
export const CARD_PAPER = "#fcf7ea";
/** The window inside the frame, in card units: where the art and the letters live. */
export const WINDOW = { x: 42, y: 42, w: 1116, h: 591, r: 12 };

/**
 * The line the letters' feet stand on, from the card's top: two thirds of the way down. (The old
 * scenes put it three quarters down, and on a framed card that left the word sitting low in every
 * scene: starl3xx, 2026-11-25.)
 */
export const FEET_Y = 450;
export const FEET_SHARE = FEET_Y / CARD_H;
