/**
 * The card's stock: a playing card's finish, a fine CROSSHATCH pressed into the paper on the
 * diagonal (decisions.md #58, part 4; starl3xx: "15A is good", then, of a first build too faint
 * to see, "i can't see the weave on any cards", then "the crosshatch looks so good").
 *
 * Each direction is a dark hairline with a light one beside it, as a line pressed into paper has a
 * shadow and a lit edge: so both directions show on dark art and on pale paper alike. One
 * direction is a little weaker than the other. No random grain.
 *
 * ONE SOURCE FOR EVERY PLACE A CARD IS DRAWN. The owner, when the game had it and the pictures
 * did not: "crosshatch isn't in the share cards images/videos, either... make sure those are all
 * updated with the latest changes".
 * - The GAME tiles a small picture (`weaveTile`) in its styles (globals.css, .cf-tex and .cb-tex:
 *   a test holds the two rules to this file, character for character). It is six pixels a repeat
 *   on any card, large or small.
 * - A PICTURE (the server's card front and back, and so the share video, which is made of those
 *   pictures) lays one drawing the size of the card over it (`weaveSheet`), in card units: the
 *   game's six pixels as they fall on the card an opened word shows on a computer.
 *
 * It lies over the art, the frame, and the plate, and UNDER the letters and the lettering, in the
 * game and in every picture. Plain shapes and one pattern: no text, no filter, nothing fetched.
 */
import { CARD_H, CARD_W } from "./engrave";

export type StockSide = "front" | "back";

export const WEAVE = {
  /** In the game, in pixels: a repeat, a hairline's width, and how far the light line stands from its dark one. */
  pitch: 6,
  weight: 0.7,
  gap: 0.98,
  /** The second direction's strength, as a share of the first's. */
  second: 0.7,
  /** The inks and their strengths: a dark line and a light one. The back's are laid on at `share` (its plate is dark, so its dark line is black). */
  front: { dark: ["#5a4a3a", 0.09], light: ["#fff", 0.11], share: 1 },
  back: { dark: ["#000", 0.2], light: ["#fff", 0.16], share: 0.55 },
  /** The game's tile, in pixels: eight repeats, so a card is a few hundred tiles and not tens of thousands. */
  tile: 48,
  /** The width in pixels of the card that a picture's weave is measured on: an opened word's card on a computer. */
  pictureCard: 516,
} as const;

const r2 = (n: number) => +n.toFixed(2);

/** The four sets of lines for a repeat of `p`, as path elements. `q` is the quote the markup uses. */
function lines(side: StockSide, p: number, w: number, o: number, q: string): string {
  const { dark, light } = WEAVE[side];
  const up = (d: number) => [-1, 0, 1, 2].map((c) => `M${r2(c * p + d + p)} ${-p}L${-p} ${r2(c * p + d + p)}`).join("");
  const down = (d: number) => [-2, -1, 0, 1].map((c) => `M${-p} ${r2(-p + c * p + d)}L${2 * p} ${r2(2 * p + c * p + d)}`).join("");
  const line = (d: string, ink: string, a: number) => `<path d=${q}${d}${q} stroke=${q}${ink}${q} stroke-opacity=${q}${a}${q} stroke-width=${q}${w}${q}/>`;
  const weak = (a: number) => r2(a * WEAVE.second * 100) / 100;
  return line(up(0), dark[0], dark[1]) + line(up(o), light[0], light[1]) + line(down(0), dark[0], weak(dark[1])) + line(down(o), light[0], weak(light[1]));
}

/** The game's tile: a whole SVG document, as the styles hold it (before it is made safe for a `url()`). */
export function weaveTile(side: StockSide): string {
  const { pitch: p, weight: w, gap: o, tile: s } = WEAVE;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><pattern id='w' width='${p}' height='${p}' patternUnits='userSpaceOnUse'>${lines(side, p, w, o, "'")}</pattern><rect width='${s}' height='${s}' fill='url(#w)'/></svg>`;
}

/** A picture's measures, in card units: the game's pixels on the card an opened word shows (the repeat is whole, so it tiles cleanly). */
export function sheetMeasures(): { pitch: number; weight: number; gap: number } {
  const k = CARD_W / WEAVE.pictureCard;
  return { pitch: Math.round(WEAVE.pitch * k), weight: +(WEAVE.weight * k).toFixed(1), gap: +(WEAVE.gap * k).toFixed(1) };
}

/** A picture's weave: the inside of an SVG document the size of a card (lib/cardArt/engrave, `svgDoc`), laid over a card's side. */
export function weaveSheet(side: StockSide): string {
  const { pitch, weight, gap } = sheetMeasures();
  const share = WEAVE[side].share;
  return `<defs><pattern id="weave" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse">${lines(side, pitch, weight, gap, '"')}</pattern></defs><rect width="${CARD_W}" height="${CARD_H}" fill="url(#weave)"${share < 1 ? ` opacity="${share}"` : ""}/>`;
}
