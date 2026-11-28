/**
 * The game's own star, crown, and twinkle (decisions.md #66, part 2; the design audit's 2C,
 * starl3xx, 2026-11-27: "2C and 2D are g2g"). They took the place of three icons from the bought
 * set, which were solid shapes with no ink line, from somewhere else.
 *
 * What each means has not changed: **the star is ascension, the crown is a raised letter, and
 * the twinkle is "new"** (a word just claimed, something coming). So none of them is ever one of
 * the rarity marks (lib/tierMark), and a new mark must not look like one of these.
 *
 * One manner for all three, the letters' own: an even ink outline, one flat gold fill, and, where
 * the mark is large enough to hold them, a few ruled lines for shade on the side away from the
 * light (which comes from the upper left, as on the rarity marks). The twinkle is the four-point
 * star the letters already wear when gilded and throw as confetti (`TileCharacter`, `star4`).
 *
 * Pure data: each mark is a closed outline in a 24 × 24 box, plus line segments worked out here
 * once, so a mark needs no clip path, no id, no gradient, no filter, no text, and no motion. It
 * costs nothing to show, and it can be drawn anywhere.
 */
export type MarkKind = "star" | "crown" | "twinkle";

/** The box every mark is drawn in. */
export const MARK_BOX = 24;
/** The gold the letters' own twinkles, pips' rings, and confetti are filled with (`TileCharacter`, GOLD). */
export const MARK_GOLD = "#f0a617";

type Pt = readonly [number, number];
const r2 = (v: number) => +v.toFixed(2);

/** A star of `n` points about (cx, cy): outer radius R, inner radius r, first point straight up. */
function starPoints(n: number, cx: number, cy: number, R: number, r: number): Pt[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI / n) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    return [r2(cx + rad * Math.cos(a)), r2(cy + rad * Math.sin(a))] as const;
  });
}

/** Each mark's outline, as its corners in order. */
export const MARK_POINTS: Record<MarkKind, Pt[]> = {
  // five points, a little low in the box so it sits level with text
  star: starPoints(5, 12, 12.9, 10.9, 5.5),
  // three peaks over a band: the outer peaks lean out, as a drawn crown's do
  crown: [
    [4.2, 20.6],
    [19.8, 20.6],
    [22, 6.8],
    [16.4, 12.4],
    [12, 3.2],
    [7.6, 12.4],
    [2, 6.8],
  ],
  // four points, the letters' own twinkle (the same share of inner to outer radius as `star4`)
  twinkle: starPoints(4, 12, 12, 10.8, 4.6),
};

const pathOf = (pts: readonly Pt[]) => `M${pts.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
/** Each mark's outline as a path. */
export const MARK_OUTLINE: Record<MarkKind, string> = { star: pathOf(MARK_POINTS.star), crown: pathOf(MARK_POINTS.crown), twinkle: pathOf(MARK_POINTS.twinkle) };

/** The crown's band: one rule above its foot, inside the outline. */
export const CROWN_BAND = "M5.4 16.8H18.6";

/**
 * The shade: ruled lines a pitch apart, leaning 45°, across the half of the mark that is turned
 * from the light (lower right), each cut to the inside of the outline and kept clear of it.
 * Worked out by crossing each line with the outline's edges, so nothing has to be clipped when it
 * is drawn.
 */
const SHADE_PITCH = 2.5;
const SHADE_CLEAR = 1.15;
function shadeOf(pts: readonly Pt[]): string {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let d = "";
  // a line is x + y = c, running up to the right; the ones past the middle are on the shade side
  for (let c = cx + cy + SHADE_PITCH * 0.6; c < MARK_BOX * 2; c += SHADE_PITCH) {
    // where it crosses the outline, as its distance along the line (t = x - y)
    const ts: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const f1 = x1 + y1 - c;
      const f2 = x2 + y2 - c;
      if (f1 === f2 || f1 * f2 > 0) continue;
      const k = f1 / (f1 - f2);
      ts.push(x1 + (x2 - x1) * k - (y1 + (y2 - y1) * k));
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const [a, b] = [ts[i] + SHADE_CLEAR * Math.SQRT2, ts[i + 1] - SHADE_CLEAR * Math.SQRT2];
      if (b - a < 1.2) continue; // too short to read as a line
      // back from (c, t) to x and y: x = (c + t) / 2, y = (c - t) / 2
      d += `M${r2((c + a) / 2)} ${r2((c - a) / 2)}L${r2((c + b) / 2)} ${r2((c - b) / 2)}`;
    }
  }
  return d;
}
/** Each mark's shade lines as one path (strokes only). */
export const MARK_SHADE: Record<MarkKind, string> = { star: shadeOf(MARK_POINTS.star), crown: shadeOf(MARK_POINTS.crown), twinkle: shadeOf(MARK_POINTS.twinkle) };

/** The twinkle's four hairline rays, between its points: drawn only where it is large. */
export const TWINKLE_RAYS = [45, 135, 225, 315]
  .map((deg) => {
    const a = (deg * Math.PI) / 180;
    const at = (rad: number) => `${r2(12 + rad * Math.cos(a))} ${r2(12 + rad * Math.sin(a))}`;
    return `M${at(7.4)}L${at(10.8)}`;
  })
  .join("");

/** From this size (in pixels) a mark holds its shade lines; under it they would be finer than a pixel apart. */
export const SHADE_FROM = 20;
/** From this size the twinkle also shows its rays. */
export const RAYS_FROM = 28;

/**
 * The outline's weight for a mark shown `size` pixels wide, in the box's units: a pixel at text
 * sizes, growing a little with the mark, never under a pixel on the screen.
 */
export function markStroke(size: number): number {
  const px = Math.min(1.9, Math.max(1, size * 0.08));
  return r2((px * MARK_BOX) / size);
}
/** The weight of a shade line or a ray, the same way: about three quarters of a pixel. */
export function markHairline(size: number): number {
  return r2((Math.min(1, Math.max(0.75, size * 0.03)) * MARK_BOX) / size);
}
