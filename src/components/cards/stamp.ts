/**
 * The holder's picture, stamped on the back of their cards (decisions.md #48, part 6; starl3xx:
 * "how can we feature an owner's PFP on the back of the card... maybe as a slightly rotated
 * circular stamp somewhere? (UI and share video)", then "one ink, engraved ring beside the number,
 * and yes they can turn it off").
 *
 * The stamp is not part of a letter, so it is drawn like the cards: the picture in ONE INK (the
 * material's line colour, as the pressed seal is), in an engraved ring (a rosette, from the
 * engraving kit), turned a little.
 *
 * This file is the stamp's shapes and arithmetic, pure, for the two things that draw it: the
 * game's back (CardBack, in CSS) and the share video (loop/makeLoop, on a canvas, where no CSS
 * filter can be trusted to exist).
 */
import { rosette } from "@/lib/cardArt/engrave";

/** How far the stamp is turned, in degrees. */
export const STAMP_TURN = -8;
/** The picture's circle, as a share of the stamp's box (the ring takes the rest). */
export const STAMP_FACE = 0.74;

/** The ring, in the material's line colour: two rosettes a little apart, and a plain line inside them. One SVG document, no text, nothing fetched. */
export function stampRingSvg(ink: string): string {
  const petals = rosette(60, 60, 54, 3.2, 28, 240);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="${petals}" fill="none" stroke="${ink}" stroke-width="2"/><path d="${petals}" fill="none" stroke="${ink}" stroke-width="1" transform="rotate(6.43 60 60)"/><circle cx="60" cy="60" r="47.5" fill="none" stroke="${ink}" stroke-width="1.6"/></svg>`;
}

/**
 * Where the stamp sits on the back's PICTURE (app/s/[text]/back, 1200 wide), as shares of the
 * card's width: its centre and its size. Beside the number where the card has one (the picture's
 * number ends about 34% across: "No." and four digits in the route's measures), in the top left
 * corner where it has none. The game's own back needs none of this: there the stamp follows the
 * digits in the page's layout.
 */
export function stampBox(numbered: boolean): { cx: number; cy: number; size: number } {
  return numbered ? { cx: 0.4008, cy: 0.196, size: 0.102 } : { cx: 0.133, cy: 0.075, size: 0.086 };
}
/**
 * The back's picture says in a header whether it drew the card's number, and the share video places
 * the stamp by THAT, never by what the game knows: the picture reads the number itself (the chain,
 * with a wait, kept for minutes; none where there is no chain), so the game and the picture can
 * differ, and a stamp placed by the game's answer sat beside a number that wasn't there, or in the
 * corner of a numbered back (Bugbot on #257).
 */
export const NUMBERED_HEADER = "x-card-numbered";
/** What the header says: true, false, or null for a picture that doesn't say (one kept from before the header: no stamp is drawn on it). */
export function numberedFrom(headers: { get(name: string): string | null }): boolean | null {
  const v = headers.get(NUMBERED_HEADER);
  return v === "1" ? true : v === "0" ? false : null;
}
/** The left edge of the picture's ledger, as a share of the width: the stamp must stay left of it. */
export const LEDGER_LEFT = 0.499;

/**
 * A picture's pixels (RGBA) turned to one ink, in place: black stays black, and white becomes the
 * ink, as CSS's grayscale + multiply does on the game's back (globals.css, .cb-stamp-face). With
 * the same lift in contrast and brightness.
 */
export function oneInk(data: Uint8ClampedArray, ink: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    const g = Math.min(1, Math.max(0, ((lum - 0.5) * 1.25 + 0.5) * 1.05));
    data[i] = Math.round(ink[0] * g);
    data[i + 1] = Math.round(ink[1] * g);
    data[i + 2] = Math.round(ink[2] * g);
  }
}

/** "#e9b949" as [233, 185, 73]. */
export function inkRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
