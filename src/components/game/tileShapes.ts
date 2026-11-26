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
/** The ground shadow under the shoes: its place and size. */
export const SHADOW = { cx: CX, cy: FOOT_Y + 3, rx: 76, ry: 10 };
/**
 * The shadow as it is drawn (decisions.md #48): ruled lines in the shape of the shadow, heavier
 * toward its middle, the way an engraving makes tone. What is on a letter is flat and colourful;
 * what is around a letter is drawn like the cards, and the shadow is the one such thing under every
 * letter. It was a grey oval. One list for the rig and the share card's still, typed out (not
 * computed with a square root at run time) so the server and the browser can't differ in a digit.
 */
export const SHADOW_LINES: readonly { y: number; x0: number; x1: number; w: number }[] = [
  { y: 295.2, x0: 72.4, x1: 167.6, w: 1.15 },
  { y: 297.8, x0: 55.1, x1: 184.9, w: 1.34 },
  { y: 300.4, x0: 46.6, x1: 193.4, w: 1.52 },
  { y: 303, x0: 44, x1: 196, w: 1.7 },
  { y: 305.6, x0: 46.6, x1: 193.4, w: 1.52 },
  { y: 308.2, x0: 55.1, x1: 184.9, w: 1.34 },
  { y: 310.8, x0: 72.4, x1: 167.6, w: 1.15 },
];
export const SHADOW_LINE_OPACITY = 0.62;
/** Where the ground starts, a little above the shadow's top line: what stands behind a letter (the rays of a raised one) ends here. */
export const GROUND_Y = FOOT_Y - 8;
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

// ── the UPPERCASE ring and the gilding ───────────────────────────────────────────────────────────
/** An UPPERCASE tile's blue border. */
export const BORDER_UP = 12;
/** The pale ring outside it, on a letter that is not gilded. */
export const RING_PB = 10;
/**
 * The gilding, by stage: a gold ring, a pale line outside it, and from Gilded 4 a second gold ring.
 * Slim (decisions.md #48; starl3xx: "they're too thick", then "slim gilding"): 8, 9, 10, 13.5, 13.5
 * units outside the blue border, where it was 13, 15, 17, 22, 22. The ring no longer tries to count
 * the stage (stages 1 to 3 differed by 2 units, which nobody could read): it says gilded, doubled
 * from Gilded 4, and foil at Holographic. The pips say the stage.
 */
export const GILD = { gold: [0, 5, 6, 7, 7, 7], pale: 3, gold2: 3.5 } as const;
export type RingPart = "plain" | "gold" | "pale";
/** The rings outside the blue border, from the border outward. */
export function ringParts(gild: number): { w: number; part: RingPart }[] {
  if (gild <= 0) return [{ w: RING_PB, part: "plain" }];
  const out: { w: number; part: RingPart }[] = [
    { w: GILD.gold[Math.min(5, Math.round(gild))], part: "gold" },
    { w: GILD.pale, part: "pale" },
  ];
  if (gild >= 4) out.push({ w: GILD.gold2, part: "gold" });
  return out;
}
/** How far the rings reach past the tile's edge. */
export function ringOuter(gild: number): number {
  return ringParts(gild).reduce((e, r) => e + r.w, BORDER_UP / 2);
}
/** Each ring as a rounded rectangle's numbers (a stroke of width `sw`), each abutting the last. */
export function ringRects(gild: number): { x: number; y: number; w: number; h: number; rx: number; sw: number; part: RingPart }[] {
  let edge = BORDER_UP / 2; // the outer face of the blue border
  return ringParts(gild).map((r) => {
    const off = edge + r.w / 2;
    edge += r.w;
    return { x: T.x - off, y: T.y - off, w: T.w + 2 * off, h: T.h + 2 * off, rx: T.r + off, sw: r.w, part: r.part };
  });
}

/** Holographic's foil (stage 5), in place of the gold: the colours of its gradient, in order. */
export const HOLO_STOPS: readonly (readonly [number, string])[] = [
  [0, "#ff9ad5"],
  [0.25, "#ffe28a"],
  [0.5, "#8ff0d0"],
  [0.75, "#8ec5ff"],
  [1, "#c7a0ff"],
];

// ── the stage's pips ─────────────────────────────────────────────────────────────────────────────
/**
 * One pip a stage, on the tile's lower face: black diamonds (decisions.md #48; starl3xx: "black
 * diamonds... let's make all of them like that, including holographic"). An earned pip is solid
 * ink at every stage; one not yet reached is a faint outline, which reads on every rarity's face, so
 * no white plate sits under them. They were gold on white squares with a grey line, the fifth foil.
 */
export const PIP_Y = BOT - 22;
export const PIP_SIZE = 7.4;
/** The printed letter rises by this when pips sit under it. */
export const PIP_NUDGE = 12;
/** Pip i (0 to 4) as a path. */
export function pipPath(i: number, s = PIP_SIZE): string {
  const cx = CX + (i - 2) * 22;
  return `M ${cx} ${PIP_Y - s} L ${cx + s} ${PIP_Y} L ${cx} ${PIP_Y + s} L ${cx - s} ${PIP_Y} Z`;
}

// ── the laurels ──────────────────────────────────────────────────────────────────────────────────
/**
 * What a letter wears from Gilded 4: two laurel sprigs arching over its head from the top corners,
 * open at the top (decisions.md #48; starl3xx: "laurels for now"). It replaces a crown 36 units
 * wide that sat between the eyes, where the eyes hid all of it but the peak. Worn by the letter, so
 * it is flat and outlined like the rest of it.
 */
/** A leaf, pointing along +x from its stem end. */
export const LAUREL_LEAF = "M 0 0 C 5 -6.5 15 -6.5 22 0 C 15 6.5 5 6.5 0 0 Z";
/**
 * The LEFT sprig for a ring that reaches `ro` past the tile: its stem, and where each leaf goes
 * (a transform for LAUREL_LEAF). The right sprig is its mirror: `translate(${VB.w} 0) scale(-1 1)`.
 * Rounded: the server draws this too, and engines differ in a sine's last digit.
 */
export function laurel(ro: number): { stem: string; leaves: string[] } {
  const R = T.w / 2 + ro + 25;
  const at = (deg: number) => `${(CX + R * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(MID + R * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const leaf = (deg: number, turn: number, scale = 1) => `translate(${at(deg)}) rotate(${deg + turn})${scale === 1 ? "" : ` scale(${scale})`}`;
  return {
    stem: `M ${at(-142)} A ${R} ${R} 0 0 1 ${at(-98)}`,
    leaves: [
      // outside the stem, leaning out
      ...[-139, -128, -117, -106].map((d) => leaf(d, 56)),
      // inside it, leaning in, a little smaller
      ...[-134, -123, -112].map((d) => leaf(d, 124, 0.86)),
      // the tip
      leaf(-98, 90, 0.9),
    ],
  };
}

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
  // An integer hash of the letter, its place, and the word's length. Not Math.sin: engines may
  // differ in its last bit, and the server draws this too (the share card, and a share page that
  // the browser then takes over), so "the same every time" has to mean exactly the same.
  let h = Math.imul(word.toUpperCase().charCodeAt(i), 73856093) ^ Math.imul(i + 1, 19349663) ^ Math.imul(word.length, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  const unit = ((h >>> 0) / 4294967295) * 2 - 1;
  return Number((unit * max).toFixed(2));
}
