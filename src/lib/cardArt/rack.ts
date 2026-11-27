/**
 * The tile rack on a card's back, engraved (decisions.md #48, part 9): the shelf the word's tiles
 * stand on. It was a flat shelf in two tones of the material. A rack is not part of a letter, so it
 * is drawn like the card: in the material's line colour, its top face ruled the way an engraver
 * rules a surface that runs away (the lines closer together toward the back), its front in shadow
 * under closer ruling, with one bright line along the edge the tiles stand behind.
 *
 * One set of shapes for the game's back (components/cards/CardBack, which stretches the rack to
 * the row and keeps its lines one weight with `vector-effect`) and the server's picture of the
 * back (app/s/[text]/back, which asks for it in its own pixels: Satori's renderer is not asked to
 * keep a stretched line's weight). Pure: strings of numbers, one decimal.
 */
import { n1 } from "./engrave";

/** The rack's own box: the shapes are laid out in it, then scaled to the box asked for. */
const BOX = { w: 100, h: 20 };
/** The top face: its far edge, and its near edge (which is the front's top edge). */
const TOP = { farY: 4, nearY: 13, farInset: 5 };
/** Rules across the top face, far to near: the gaps grow toward the viewer. */
const TOP_RULES = [5.3, 6.5, 7.9, 9.5, 11.3];
/** Rules across the front, top to bottom: evenly close, so it reads darker than the top. */
const FRONT_RULES = [14.5, 15.8, 17.1, 18.4];

export interface RackPaths {
  /** The top face's outline (a closed shape). */
  top: string;
  /** The rules across it. */
  topRules: string;
  /** The front's outline (a closed shape, its lower corners rounded). */
  front: string;
  /** The rules across it. */
  frontRules: string;
  /** The edge between the two: the line the tiles stand behind. */
  edge: string;
}

/** The rack's shapes in a box `w` by `h`. */
export function rackPaths(w: number = BOX.w, h: number = BOX.h): RackPaths {
  const sx = w / BOX.w;
  const sy = h / BOX.h;
  const p = (x: number, y: number) => `${n1(x * sx)} ${n1(y * sy)}`;
  // the top face narrows toward the back: how far in its side is at height y
  const inset = (y: number) => (TOP.farInset * (TOP.nearY - y)) / (TOP.nearY - TOP.farY);
  const rule = (y: number, x0: number, x1: number) => `M${p(x0, y)}L${p(x1, y)}`;
  return {
    top: `M${p(TOP.farInset, TOP.farY)}L${p(BOX.w - TOP.farInset, TOP.farY)}L${p(BOX.w, TOP.nearY)}L${p(0, TOP.nearY)}Z`,
    topRules: TOP_RULES.map((y) => rule(y, inset(y) + 1.2, BOX.w - inset(y) - 1.2)).join(""),
    front: `M${p(0, TOP.nearY)}L${p(BOX.w, TOP.nearY)}L${p(BOX.w, 18)}Q${p(BOX.w, 20)} ${p(BOX.w - 2, 20)}L${p(2, 20)}Q${p(0, 20)} ${p(0, 18)}Z`,
    // the lowest rule stops short of the rounded corners
    frontRules: FRONT_RULES.map((y, i) => rule(y, i === FRONT_RULES.length - 1 ? 2.4 : 1.4, BOX.w - (i === FRONT_RULES.length - 1 ? 2.4 : 1.4))).join(""),
    edge: rule(TOP.nearY, 0, BOX.w),
  };
}
