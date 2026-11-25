/**
 * The letter character's shapes, as numbers and paths: one source for the two things that draw it.
 * The game's rig (TileCharacter, a client component with CSS motion) and the share card's still
 * (app/_og/tile.tsx, drawn by Satori on the server, which can render neither) each used to carry
 * their own copy of these, and the card's had drifted (arms at rest inside a word, simpler eyes).
 *
 * Pure (no React, no "use client"), so the server can read the values. Everything is in the rig's
 * 240 × 340 space (design handoff §1): the tile is 150 × 150 at (45, 100).
 */
import { LINK_OVERLAP } from "@/components/scenes/layout";

export const VB = { w: 240, h: 340 };
export const T = { x: 45, y: 100, w: 150, h: 150, r: 20 };
export const CX = T.x + T.w / 2; // 120
export const TOP = T.y; //          100
export const BOT = T.y + T.h; //    250
export const MID = T.y + T.h / 2; // 175

// ── feet ─────────────────────────────────────────────────────────────────────────────────────────
export const FOOT_Y = 300;
export const FOOT_LX = CX - 30; // 90
export const FOOT_RX = CX + 30; // 150
/** The ground shadow under the shoes. */
export const SHADOW = { cx: CX, cy: FOOT_Y + 3, rx: 76, ry: 10, opacity: 0.17 };
/**
 * The shoe (local: ankle at 0,-6, toe toward +x, sole on y = 3): a bean. A round heel, a dip at the
 * instep, a taller round toe. (The old shoe was a small heel with a long, low toe, 3 px tall on the
 * stage: a point.)
 */
export const SHOE = "M -12 3 C -17 3 -18 -3 -17 -8 C -16 -15 -9 -17 -2 -15 C 4 -14 8 -14 13 -17 C 20 -22 32 -18 33 -8 C 34 -1 31 3 25 3 Z";
/** A highlight on the toe: drawn only where the tile is big enough to show it (SHINE_FROM px wide). */
export const SHOE_SHINE = "M 18 -16 Q 25 -16 27 -10";
export const SHINE_FROM = 110;
/** The legs, from under the tile to the ankles. */
export const LEG_L = `M ${CX - 24} ${BOT - 8} Q ${CX - 36} 275 ${FOOT_LX} ${FOOT_Y - 6}`;
export const LEG_R = `M ${CX + 24} ${BOT - 8} Q ${CX + 36} 275 ${FOOT_RX} ${FOOT_Y - 6}`;
/** Arms and legs are one stroke of this width, in ink. */
export const LIMB_W = 9;

// ── arms and mitts ───────────────────────────────────────────────────────────────────────────────
export interface Hand {
  /** the wrist */
  x: number;
  y: number;
  /** degrees: 0 hangs straight down (fingers toward +y) */
  rot: number;
  /** 1: thumb toward +x · -1: toward -x */
  flip: 1 | -1;
}
export interface Arm {
  d: string;
  hand: Hand;
  /** the mitt sits in front of the tile (it rests on the face or its corner) */
  front: boolean;
}
export const mirrorArm = (a: Arm): Arm => ({
  ...a,
  d: a.d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${VB.w - Number(x)} ${y}`),
  hand: { x: VB.w - a.hand.x, y: a.hand.y, rot: -a.hand.rot, flip: (a.hand.flip * -1) as 1 | -1 },
});
// The left arm of each pose (the right mirrors it, except the hero's). An arm starts well inside
// the tile, behind its face, so a lean never uncovers the shoulder.
/** at rest: out at the shoulder, then down, clear of the tile */
export const ARM_REST: Arm = { d: "M 58 158 C 30 158 24 178 25 210", hand: { x: 25, y: 210, rot: 6, flip: 1 }, front: false };
export const ARM_REST_R = mirrorArm(ARM_REST);
/** rolling: both hands up on the top corners, holding on */
export const ARM_BRACE: Arm = { d: "M 58 170 C 24 172 20 142 36 128", hand: { x: 36, y: 128, rot: -142, flip: -1 }, front: true };
export const ARM_BRACE_R = mirrorArm(ARM_BRACE);
/** the hero pose: a hand on the hip, the other waved up */
export const ARM_HIP: Arm = { d: "M 58 172 C 30 178 34 200 52 204", hand: { x: 52, y: 204, rot: -72, flip: 1 }, front: true };
export const ARM_WAVE: Arm = { d: "M 182 172 C 214 168 218 138 210 124", hand: { x: 210, y: 124, rot: 168, flip: -1 }, front: false };

/** A mitt in its own space (wrist at 0,0, fingers toward +y, thumb toward +x): a thumb, a palm over
 *  its base, a cuff where the arm goes in, and two stitches on the back (big tiles only: DARTS_FROM
 *  px wide). Two plain circles read as a ball. */
export const MITT = {
  thumb: { cx: 9.5, cy: 9.5, rx: 5, ry: 7, rot: -30 },
  palm: { cx: 0, cy: 13.5, rx: 12, ry: 12.6 },
  cuff: { x: -8.5, y: -3.5, width: 17, height: 8, rx: 4 },
  darts: "M -4 13 L -4 20 M 1.5 13.5 L 1.5 21",
};
export const DARTS_FROM = 120;
/** Where a mitt goes: the transform that carries MITT to a hand. */
export const mittAt = (h: Hand) => `translate(${h.x} ${h.y}) rotate(${h.rot}) scale(${h.flip} 1)`;

// ── holding hands ────────────────────────────────────────────────────────────────────────────────
// In a word each letter stands 0.86 of its width from the last (LINK_OVERLAP), so two tile faces
// are 56 units apart and the hands meet in the middle of that gap, low, the arms making a V. Both
// hands of a pair are drawn by the letter on the RIGHT (it is the later sibling, so it paints over
// its neighbour): one hand under, one over with its thumb across. Each arm ends deep under its
// hand, so a body can breathe, lean, and rise while the hands stay joined.
/** How far apart two letters of a word stand, in units. */
export const PITCH = VB.w * (1 - LINK_OVERLAP);
/** Where a pair's hands meet, in the right-hand letter's space. */
export const CLASP_X = (VB.w - PITCH) / 2; // 16.8
export const CLASP_Y = 207;
/** the arm to my left neighbour, and to my right */
export const LINK_L = `M 58 162 C 38 163 27 176 ${CLASP_X + 6.2} ${CLASP_Y + 1}`;
export const LINK_R = `M 182 162 C 202 163 213 176 ${PITCH + CLASP_X - 6.2} ${CLASP_Y + 2}`;
/** The clasp, back to front: two cuffs (each along its own arm), the hand under (my neighbour's),
 *  my thumb across it, my hand over, and its stitches. */
export const CLASP = (() => {
  const ux = CLASP_X - 6.2;
  const ox = CLASP_X + 6.2;
  const y = CLASP_Y;
  return {
    cuff: { x: -8, y: -4, width: 16, height: 8, rx: 4 },
    cuffs: [`translate(${ux - 2.5} ${y - 10}) rotate(18)`, `translate(${ox + 2.5} ${y - 10}) rotate(-18)`],
    under: { cx: ux, cy: y + 1, rx: 11.6, ry: 12 },
    thumb: { cx: ox - 9.5, cy: y - 5.5, rx: 7, ry: 4.4, rot: 24 },
    over: { cx: ox, cy: y, rx: 12, ry: 12.4 },
    darts: `M ${ox - 1.5} ${y - 1} L ${ox - 1.5} ${y + 6} M ${ox + 4} ${y - 0.5} L ${ox + 4} ${y + 6.5}`,
  };
})();

// ── eyes ─────────────────────────────────────────────────────────────────────────────────────────
/** How far the plain UPPERCASE ring reaches past the tile (half the blue border + the pale ring). */
export const RING_PLAIN = 16;
/**
 * The eyes: tall ovals perched on the tile's top edge, a little closer together than circles would
 * sit. On an UPPERCASE tile they ride its ring's outer edge (`ring`: how far the ring stack reaches
 * past the tile), so they stay near the top as gilding thickens it.
 */
export function eyeBox(upper: boolean, ring = RING_PLAIN) {
  const rx = upper ? 20 : 19;
  const ry = upper ? 22.5 : 21.5;
  return { rx, ry, dx: upper ? 24 : 23, y: upper ? TOP + ry - 2.5 - ring : TOP + 3 };
}
/**
 * The pupil of the eye at (ex, ey): one big oval set a touch toward the nose (they look at you, not
 * past you), with the pie-slice cut that makes it a vaudeville eye. `side` is -1 for the left eye.
 * `smiling` lifts it, to show over a lower lid pushed up by a smile.
 */
export function pupilOf(ex: number, ey: number, rx: number, ry: number, side: -1 | 1, smiling = false) {
  const prx = rx * 0.5;
  const pry = ry * 0.56;
  const px = ex - side * 1.6;
  const py = ey + ry * (smiling ? -0.16 : 0.12);
  return {
    cx: px,
    cy: py,
    rx: prx,
    ry: pry,
    cut: `M ${px} ${py} L ${px + prx * 1.2} ${py - pry * 0.3} A ${prx * 1.25} ${pry * 1.25} 0 0 0 ${px + prx * 0.5} ${py - pry * 1.15} Z`,
  };
}

// ── the lean ─────────────────────────────────────────────────────────────────────────────────────
/** The most a letter leans at rest in a word, in degrees (starl3xx, 2026-11-25: "lean looks good"). */
export const WORD_LEAN = 2;
/**
 * A letter's resting lean in a word, in degrees, about its feet (CX, BOT): uneven, like tiles set
 * down by hand, and the same every time for the same word, in the app and on the share card. Never
 * more than `max`, so it stays clear of a mood's slump (3° and 6°, the whole word one way).
 */
export function leanFor(word: string, i: number, max = WORD_LEAN): number {
  if (!max) return 0;
  const h = Math.sin(word.toUpperCase().charCodeAt(i) * 12.9898 + i * 78.233 + word.length * 3.7) * 43758.5453;
  const unit = (h - Math.floor(h)) * 2 - 1;
  return Number((unit * max).toFixed(2));
}
