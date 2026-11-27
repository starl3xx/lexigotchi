/**
 * The rays behind a word when its ascension lands (the ascend sheet), engraved (decisions.md #48,
 * part 8): a "glory", as engravers draw light. Fine ruled rays of three lengths and twelve wedges
 * with pale light inside them, in one ink. It is the drawing behind a raised letter (TileCharacter,
 * Glory), sized for a whole word, without that one's ring of beads: here the middle of the glory
 * is hidden behind the word, and a ring would show only as two odd arcs of dots between letters.
 * It was a flat gold fan: a conic gradient.
 *
 * The rays are around the letters, not on them, so they are drawn like the cards and not like the
 * letters (starl3xx: "anything NOT on the letter/body should be in the card style").
 *
 * ONE STILL PICTURE, built as a string like every scene (./engrave says why): the sheet shows it
 * as a background image and turns the whole element (globals.css, .asc-rays), so the letters in
 * front are never redrawn for it. No text, no filter, nothing fetched, every number rounded.
 */
import { n1, svgDataUri } from "./engrave";

/** The picture is a square this many units a side; the rays start `inner` from its middle and the longest end at its edge. */
export const GLORY = { size: 1000, inner: 60, rays: 144, wedges: 12 } as const;

/** The glory as an SVG document, in `ink` (the wedges' light is the same ink, faint). */
export function gloryDoc(ink: string): string {
  const c = GLORY.size / 2;
  const at = (r: number, t: number) => `${n1(c + r * Math.cos(t))} ${n1(c + r * Math.sin(t))}`;
  const every = GLORY.rays / GLORY.wedges; // a wedge stands at every twelfth ray
  let fine = "";
  for (let i = 0; i < GLORY.rays; i++) {
    if (i % every === 0) continue;
    const t = (i / GLORY.rays) * Math.PI * 2;
    // between two wedges: the middle ray longest, then two lengths in turn
    const r1 = i % every === every / 2 ? 470 : i % 2 === 0 ? 420 : 370;
    fine += `M${at(GLORY.inner, t)}L${at(r1, t)}`;
  }
  let wedges = "";
  for (let i = 0; i < GLORY.wedges; i++) {
    const t = (i / GLORY.wedges) * Math.PI * 2;
    wedges += `M${at(GLORY.inner, t - 0.05)}L${at(c, t)}L${at(GLORY.inner, t + 0.05)}`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLORY.size} ${GLORY.size}">` +
    `<path d="${fine}" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="${wedges}" fill="${ink}" fill-opacity="0.16" stroke="${ink}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/** The game's bright gold: the rays behind a raised letter are in it too (TileCharacter, GOLD). */
export const GLORY_GOLD = "#f0a617";
/** The glory as a CSS value, `url("…")`, for the sheet's `--asc-glory`. Built once. */
export const GLORY_CSS = `url("${svgDataUri(gloryDoc(GLORY_GOLD))}")`;
