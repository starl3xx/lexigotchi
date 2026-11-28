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

/**
 * Every line as ONE path: upright strokes a pitch apart, in a frame turned `lean` degrees about
 * the card's corner, as many as cross the card.
 *
 * Plain strokes, never a `<pattern>`. The card in focus keeps these lines as a bitmap
 * (components/scenes/useLinesBitmap), and WebKit draws a TURNED pattern upright when it draws a
 * picture into a bitmap: the lines lost their lean, and their spacing went uneven. A path is drawn
 * the same way everywhere. Its strokes stand exactly where the pattern's did.
 */
export function lightStrokes(): string {
  const { pitch, at, lean } = LIGHT;
  const rad = (lean * Math.PI) / 180;
  // the card's four corners, seen in the turned frame
  const corners = [0, CARD_W].flatMap((x) => [0, CARD_H].map((y) => [x * Math.cos(rad) + y * Math.sin(rad), y * Math.cos(rad) - x * Math.sin(rad)]));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const top = Math.floor(Math.min(...ys)) - 2;
  const bottom = Math.ceil(Math.max(...ys)) + 2;
  let d = "";
  for (let k = Math.floor((Math.min(...xs) - at) / pitch); k * pitch + at <= Math.max(...xs) + pitch; k++) d += `M${+(k * pitch + at).toFixed(2)} ${top}V${bottom}`;
  return d;
}

/** The lines, as the inside of an SVG document the size of a card (lib/cardArt/engrave, `svgDoc`). */
export function lightLines(ink: LightInk): string {
  const { weight, lean } = LIGHT;
  const ruled = (stroke: string, strength: string) => `<path transform="rotate(${lean})" d="${lightStrokes()}" fill="none" stroke="${stroke}"${strength} stroke-width="${weight}"/>`;
  if (ink !== "spectrum") return ruled(PAINT[ink], ` stroke-opacity="${LIGHT.ink}"`);
  // the same lines, cut out of a spectrum that runs the width of the card
  const all = `width="${CARD_W}" height="${CARD_H}"`;
  const stops = SPECTRUM.map((c, i) => `<stop offset="${i / (SPECTRUM.length - 1)}" stop-color="${c}"/>`).join("");
  return `<defs><linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${CARD_W}" y2="0">${stops}</linearGradient><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" ${all}>${ruled("#ffffff", "")}</mask></defs><rect ${all} fill="url(#ink)" mask="url(#m)" opacity="${LIGHT.ink}"/>`;
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
