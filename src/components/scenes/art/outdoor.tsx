/**
 * Shared by the outdoor scenes (the seasons): where the horizon sits, how high a sun or moon hangs,
 * a band of haze on the horizon, grass, and a little vector math for drawing along curves.
 */
import type { ReactElement } from "react";
import { SCENE_W, lin, scatter, type Ctx } from "../kit";

/** Where sky meets land: a little above the word's head on a phone, so the land fills the bottom. */
export const horizon = (c: Ctx) => c.G - 170;

/**
 * A height in the sky, as a share of the way down to the horizon. Suns, moons, and clouds sit at a
 * share rather than a fixed distance, so X's shorter card keeps them whole instead of cutting them.
 */
export const up = (hz: number, share: number) => Math.round(hz * share);

/** Grass blades across the ground in a few tones, bigger toward the viewer. */
export function tufts(c: Ctx, seed: number, n: number, tones: string[]): ReactElement {
  const top = horizon(c) + 40;
  const items = scatter(seed, n, (r) => {
    const y = top + r.next() * (c.h - top);
    return { x: r.next() * SCENE_W, y, s: 0.5 + ((y - top) / (c.h - top)) * 1.1, fill: tones[r.int(tones.length)], flip: r.next() < 0.5 ? -1 : 1 };
  });
  items.sort((a, b) => a.y - b.y);
  return (
    <g>
      {items.map((t, i) => (
        <path
          key={i}
          transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) scale(${(t.s * t.flip).toFixed(2)} ${t.s.toFixed(2)})`}
          d="M -9 0 Q -8 -9 -5 -16 L -2 0 Q 0 -12 1 -20 L 4 0 Q 6 -8 8 -14 L 10 0 Z"
          fill={t.fill}
        />
      ))}
    </g>
  );
}

/** A soft band of `color` on the horizon: far things fade into the air. */
export function haze(c: Ctx, y: number, height: number, color = "#ffffff", strength = 0.5): ReactElement {
  return (
    <g>
      <defs>{lin(c.id(`haze${y}`), [[0, color, 0], [0.55, color, strength], [1, color, 0]])}</defs>
      <rect x={0} y={y - height / 2} width={SCENE_W} height={height} fill={c.url(`haze${y}`)} />
    </g>
  );
}

export type Pt = [number, number];

/** A point on the quadratic curve p0 → (control p1) → p2, at t in [0, 1]. */
export function quad(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** The curve's direction at t, as a unit vector. */
export function quadDir(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Points to an SVG path: "M x y L x y …". */
export function poly(points: Pt[], close = true): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + (close ? " Z" : "");
}
