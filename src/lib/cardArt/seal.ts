/**
 * The game's seal, pressed into the back of every card in one ink (decisions.md #35): the logo's
 * letter tile with its eyes, inside a ring of engraved line work. One drawing, as SVG markup
 * (./engrave says how and why), for the game's card back and the server's picture of it.
 *
 * What the owner asked for (starl3xx, 2026-11-25):
 * - "I really like the Pressed, one ink version of the back": the seal sits in the material,
 *   behind the facts, in the back's own line colour.
 * - "the lines go through the eyes, and they shouldn't": the eyes are in front of the tile, so
 *   everything behind them is cut away where they are (a mask).
 * - "the eyes ... should also have the triangular cutouts", then "invert the colors of the eyes, so
 *   the irises aren't colored": in one ink the eyeball is ink, the pupil is clear, and the pupil's
 *   pie cut is ink again. The shapes are the letters' own (tileShapes, pupilOf).
 *
 * A seal has no paper colour to fill with (it is pressed into whatever is under it), which is why
 * these are masks and not white fills.
 */
import { pupilOf } from "@/components/game/tileShapes";
import { guilloche } from "./engrave";

/** The seal's box: SEAL × SEAL units, the ring touching its edges. */
export const SEAL = 512;
const C = SEAL / 2;
const EYE = { dx: 44, y: 116, rx: 38, ry: 44, line: 6 };

/** The seal in one ink, as SVG markup for svgDoc(…, SEAL, SEAL). */
export function sealInk(ink: string): string {
  const eyes = ([-1, 1] as const).map((side) => {
    const ex = C + side * EYE.dx;
    return { side, ex, p: pupilOf(ex, EYE.y, EYE.rx, EYE.ry, side) };
  });
  // what is behind the eyes stops at them
  const behind = `<mask id="behind" maskUnits="userSpaceOnUse" x="0" y="0" width="${SEAL}" height="${SEAL}"><rect width="${SEAL}" height="${SEAL}" fill="#fff"/>${eyes
    .map((e) => `<ellipse cx="${e.ex}" cy="${EYE.y}" rx="${EYE.rx + EYE.line / 2}" ry="${EYE.ry + EYE.line / 2}" fill="#000"/>`)
    .join("")}</mask>`;
  const rings = `<g fill="none" stroke="${ink}">
    <circle cx="${C}" cy="${C}" r="250" stroke-width="5"/><circle cx="${C}" cy="${C}" r="238" stroke-width="2.4"/><circle cx="${C}" cy="${C}" r="204" stroke-width="2.4"/>
    <rect x="96" y="106" width="320" height="320" rx="68" stroke-width="7"/><rect x="120" y="130" width="272" height="272" rx="48" stroke-width="3"/><rect x="142" y="152" width="228" height="228" rx="28" stroke-width="5"/>
  </g>`;
  const band = guilloche("band", C, C, 221, 12, 26, 5, ink, 1.6, 0.9);
  // each eye: one inked oval with its pupil taken out of it and the pie cut put back
  const eye = (e: (typeof eyes)[number]) => {
    const id = e.side < 0 ? "eyel" : "eyer";
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SEAL}" height="${SEAL}"><rect width="${SEAL}" height="${SEAL}" fill="#fff"/><ellipse cx="${e.p.cx}" cy="${e.p.cy}" rx="${e.p.rx}" ry="${e.p.ry}" fill="#000"/><path d="${e.p.cut}" fill="#fff"/></mask><ellipse cx="${e.ex}" cy="${EYE.y}" rx="${EYE.rx}" ry="${EYE.ry}" fill="${ink}" stroke="${ink}" stroke-width="${EYE.line}" mask="url(#${id})"/>`;
  };
  return `<defs>${behind}</defs><g mask="url(#behind)">${rings}${band}</g><path d="M222 198h32v112h60v30h-92z" fill="${ink}"/>${eyes.map(eye).join("")}`;
}
