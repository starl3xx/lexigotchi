/**
 * The card's light, DRAWN (decisions.md #58, part 3). starl3xx, 2026-11-27, of five ways to show
 * a reflection on a card's front without shine: "I love the ruled band, but it's too strong rn...
 * needs to be more subtle".
 *
 * A reflection on a card is ruled linework, never a wash of white. This is the linework: a ground
 * of fine lines the size of the card. It STANDS STILL on the card, and a soft-edged band that
 * crosses the front shows a part of it for a moment (globals.css, `.cf-light`). The band it
 * replaced was a soft white gradient laid over the art (#34).
 *
 * - It is a PICTURE, never a CSS gradient. Slanted hairlines made of a repeating gradient broke
 *   into dashes at every pixel ratio but 2 (seen on the owner's own screen).
 * - The lines lean as the band's edges lean (`lean`), so the band reads as one piece of light.
 * - The ink is the rarity's, as the old band's was: white for most, warm for Legendary, and for
 *   Mythic a spectrum PRINTED across the card (the band shows the part of it that it passes over,
 *   so nothing in the ink itself moves).
 *
 * One document a kind of ink: no text, no filter, nothing fetched.
 */
import type { Tier } from "@/lib/economy";
import { CARD_H, CARD_W } from "./engrave";

export const LIGHT = {
  /** The lines: how far apart, how heavy, where the first one stands, and how far they lean from upright (degrees, clockwise). */
  pitch: 6.5,
  weight: 1.5,
  at: 1.5,
  lean: 10,
  /** The ink's own strength. The styles thin it further by the face the card wears (`.cf-light`). */
  ink: 0.5,
  /** Half the band's width, measured across its lines, in card units: where its light has faded to nothing. */
  half: 260,
} as const;

/** The three inks the light is drawn in. */
export type LightInk = "white" | "warm" | "spectrum";
/** Each rarity's. A collab word's card is its set's colors and no metal: it takes the plain white (the caller's rule). */
export const LIGHT_INK: Record<Tier, LightInk> = { Common: "white", Uncommon: "white", Rare: "white", Legendary: "warm", Mythic: "spectrum" };

const PAINT: Record<Exclude<LightInk, "spectrum">, string> = { white: "#ffffff", warm: "#ffecb4" };
/** Mythic's, left to right across the card: the tiles' own four colors around a white. */
const SPECTRUM = ["#ff9ad5", "#ffe28a", "#ffffff", "#8ff0d0", "#8ec5ff"] as const;

/** The lines, as the inside of an SVG document the size of a card (lib/cardArt/engrave, `svgDoc`). */
export function lightLines(ink: LightInk): string {
  const { pitch, weight, at, lean } = LIGHT;
  const ruled = (stroke: string, strength: string) =>
    `<pattern id="r" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(${lean})"><line x1="${at}" y1="0" x2="${at}" y2="${pitch}" stroke="${stroke}"${strength} stroke-width="${weight}"/></pattern>`;
  const all = `width="${CARD_W}" height="${CARD_H}"`;
  if (ink !== "spectrum") return `<defs>${ruled(PAINT[ink], ` stroke-opacity="${LIGHT.ink}"`)}</defs><rect ${all} fill="url(#r)"/>`;
  // the same lines, cut out of a spectrum that runs the width of the card
  const stops = SPECTRUM.map((c, i) => `<stop offset="${i / (SPECTRUM.length - 1)}" stop-color="${c}"/>`).join("");
  return `<defs>${ruled("#ffffff", "")}<linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${CARD_W}" y2="0">${stops}</linearGradient><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" ${all}><rect ${all} fill="url(#r)"/></mask></defs><rect ${all} fill="url(#ink)" mask="url(#m)" opacity="${LIGHT.ink}"/>`;
}

/**
 * The band's measures for the styles, in shares of the card's width (cqw there): half its width
 * across its lines, and the width of the box that holds it leaning (the band's own width along the
 * card, plus how far its lean carries it between the card's top and bottom).
 */
export function lightBand(): { half: number; box: number } {
  const rad = (LIGHT.lean * Math.PI) / 180;
  const half = (LIGHT.half / CARD_W) * 100;
  const box = 2 * (half / Math.cos(rad)) + ((CARD_H / CARD_W) * 100) * Math.tan(rad);
  return { half: +half.toFixed(2), box: Math.ceil(box) };
}
