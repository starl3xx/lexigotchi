/**
 * The drawing kit every scene shares (SceneArt.tsx says what a scene is).
 *
 * Everything a scene draws is a plain SVG element. Satori serializes the svg itself and can't call
 * a component or open a fragment in there ("Cannot convert a Symbol value to a string"), so the
 * pieces here are functions that return elements, called as `{lin(…)}`, never `<Lin/>`, and a
 * layer is one <g>. Optional attributes are spread, never passed as undefined: Satori writes an
 * undefined attribute as the text "undefined", and a transform="undefined" drops the whole group.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Rng } from "@/lib/rng";

export const SCENE_W = 1200;
/** The feet line, in scene units above the bottom edge. */
export const SCENE_FLOOR = 160;

export const INK = "#1b1714";

/** What a scene's drawing code gets: its size, the feet line, and id/animation helpers. */
export interface Ctx {
  h: number;
  /** The feet line (y). */
  G: number;
  /** A unique gradient id, and its `url(#…)`. */
  id: (name: string) => string;
  url: (name: string) => string;
  /**
   * Spread onto an element to move it: its `scn-` class (globals.css) and timing, with any
   * `--var`s its keyframes read, when animated; else nothing at all.
   */
  motion: (cls: string, duration: number, delay: number, vars?: Record<string, number | string>) => { className?: string; style?: CSSProperties };
  animated: boolean;
}

export type Layer = (c: Ctx) => ReactNode;

export function makeCtx(uid: string, h: number, animated: boolean): Ctx {
  return {
    h,
    G: h - SCENE_FLOOR,
    id: (name) => `${uid}-${name}`,
    url: (name) => `url(#${uid}-${name})`,
    motion: (cls, duration, delay, vars) =>
      animated
        ? {
            className: cls,
            style: {
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
              ...Object.fromEntries(Object.entries(vars ?? {}).map(([k, v]) => [`--${k}`, typeof v === "number" ? `${v}px` : v])),
            } as CSSProperties,
          }
        : {},
    animated,
  };
}

/** A transform attribute only when there is one. */
export function tf(transform: string | undefined): { transform?: string } {
  return transform ? { transform } : {};
}

export type Stop = [offset: number, color: string, opacity?: number];

/** A linear gradient, top to bottom (or left to right when `across`). */
export function lin(id: string, stops: Stop[], across = false): ReactElement {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={across ? 1 : 0} y2={across ? 0 : 1}>
      {stops.map(([o, color, a], i) => (
        <stop key={i} offset={o} stopColor={color} stopOpacity={a ?? 1} />
      ))}
    </linearGradient>
  );
}

export function rad(id: string, stops: Stop[]): ReactElement {
  return (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      {stops.map(([o, color, a], i) => (
        <stop key={i} offset={o} stopColor={color} stopOpacity={a ?? 1} />
      ))}
    </radialGradient>
  );
}

/** Seeded positions, so a scene's particles sit in the same places on every render and on the card. */
export function scatter<T>(seed: number, n: number, make: (r: Rng, i: number) => T): T[] {
  const r = new Rng(seed);
  return Array.from({ length: n }, (_, i) => make(r, i));
}


/** A soft dark edge on every side, so the eye goes to the middle where the word stands. */
export function vignette(c: Ctx, strength = 0.42, color = INK): ReactElement {
  return (
    <g>
      <defs>{rad(c.id("vig"), [[0.55, color, 0], [1, color, strength]])}</defs>
      <rect x={-200} y={-c.h * 0.25} width={SCENE_W + 400} height={c.h * 1.5} fill={c.url("vig")} />
    </g>
  );
}

/**
 * Things that fall through the whole scene (snow, petals, leaves), each drawn at (0, 0) by `draw`.
 * The still picture scatters them over the scene. Animated, each falls from above the top to below
 * the bottom and starts from where the still picture draws it (its delay is that far through the
 * fall), swinging side to side as it goes.
 */
export function fallers(
  c: Ctx,
  seed: number,
  n: number,
  opts: { dur: [number, number]; swing: [number, number]; draw: (r: Rng, i: number) => ReactNode; minY?: number },
): ReactElement {
  const top = -40;
  const span = c.h + 80;
  const items = scatter(seed, n, (r, i) => {
    const x = r.next() * SCENE_W;
    const y = (opts.minY ?? 0) + r.next() * (c.h - (opts.minY ?? 0));
    const d = opts.dur[0] + r.next() * (opts.dur[1] - opts.dur[0]);
    const sd = 2.4 + r.next() * 2.4;
    const dx = opts.swing[0] + r.next() * (opts.swing[1] - opts.swing[0]);
    return { x, y, d, sd, dx, sdelay: -r.next() * sd, shape: opts.draw(r, i) };
  });
  return (
    <g>
      {items.map((p, i) => (
        <g key={i} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
          <g {...c.motion("scn-fall", p.d, -((p.y - top) / span) * p.d, { y0: top - p.y, y1: top + span - p.y })}>
            <g {...c.motion("scn-swing", p.sd, p.sdelay, { dx: p.dx })}>{p.shape}</g>
          </g>
        </g>
      ))}
    </g>
  );
}

/*
 * Light comes from the upper left in every outdoor scene: the helpers below shade a form darker at
 * its lower right and catch highlights at its upper left. That one rule is most of what makes a
 * flat shape read as round.
 */

const CLOUD_PUFFS: [number, number, number][] = [
  [-70, 6, 38],
  [-28, -18, 50],
  [26, -26, 58],
  [74, -2, 42],
  [0, 10, 44],
];

/**
 * A puffy cloud, centered on (x, y), `s` times life size: a blue-grey underside, the white body,
 * and sunlit puffs at the upper left.
 */
export function cloud(x: number, y: number, s: number, shade = "#c8d7ea", opacity = 0.97): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={opacity}>
      {CLOUD_PUFFS.map(([dx, dy, r], i) => (
        <circle key={`s${i}`} cx={dx + 6} cy={dy + 10} r={r} fill={shade} />
      ))}
      <rect x={-98} y={18} width={214} height={34} rx={17} fill={shade} />
      {CLOUD_PUFFS.map(([dx, dy, r], i) => (
        <circle key={`b${i}`} cx={dx} cy={dy} r={r} fill="#ffffff" />
      ))}
      <rect x={-104} y={10} width={214} height={30} rx={15} fill="#ffffff" />
      {CLOUD_PUFFS.slice(0, 4).map(([dx, dy, r], i) => (
        <circle key={`h${i}`} cx={dx - r * 0.25} cy={dy - r * 0.3} r={r * 0.45} fill="#fbfdff" />
      ))}
    </g>
  );
}

/**
 * A round mass of overlapping puffs (a tree's crown, a bush), centered on (cx, cy) with radii rx,
 * ry, shaded in four tones: [shadow, body, light, highlight]. The shadow pass sits a little lower
 * right of the body; light and highlight puffs gather at the upper left.
 */
export function canopy(seed: number, cx: number, cy: number, rx: number, ry: number, tones: [string, string, string, string], n = 34): ReactElement {
  const puffs = scatter(seed, n, (r) => {
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next());
    return { x: Math.cos(a) * rx * d, y: Math.sin(a) * ry * d, r: (0.18 + r.next() * 0.16) * Math.min(rx, ry) * 1.4 };
  });
  const lit = puffs.filter((p) => p.y < ry * 0.25 && p.x < rx * 0.45);
  const hi = lit.filter((p) => p.y < -ry * 0.1 && p.x < rx * 0.1);
  const f = (v: number) => v.toFixed(1);
  return (
    <g transform={`translate(${f(cx)} ${f(cy)})`}>
      {puffs.map((p, i) => (
        <circle key={`s${i}`} cx={f(p.x + 9)} cy={f(p.y + 12)} r={f(p.r)} fill={tones[0]} />
      ))}
      {puffs.map((p, i) => (
        <circle key={`b${i}`} cx={f(p.x)} cy={f(p.y)} r={f(p.r)} fill={tones[1]} />
      ))}
      {lit.map((p, i) => (
        <circle key={`l${i}`} cx={f(p.x - p.r * 0.22)} cy={f(p.y - p.r * 0.25)} r={f(p.r * 0.62)} fill={tones[2]} />
      ))}
      {hi.map((p, i) => (
        <circle key={`h${i}`} cx={f(p.x - p.r * 0.35)} cy={f(p.y - p.r * 0.4)} r={f(p.r * 0.28)} fill={tones[3]} />
      ))}
    </g>
  );
}

/**
 * Small dots scattered over a box, bigger toward the bottom (nearer the viewer): sand grains,
 * distant flowers, stars. `colors` are picked at random.
 */
export function speckles(seed: number, n: number, box: [x0: number, y0: number, x1: number, y1: number], colors: string[], r: [number, number], opacity = 1): ReactElement {
  const [x0, y0, x1, y1] = box;
  const dots = scatter(seed, n, (g) => {
    const t = g.next();
    return {
      x: x0 + g.next() * (x1 - x0),
      y: y0 + t * (y1 - y0),
      r: r[0] + (r[1] - r[0]) * (0.35 * g.next() + 0.65 * t),
      fill: colors[g.int(colors.length)],
    };
  });
  return (
    <g opacity={opacity}>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={d.r.toFixed(2)} fill={d.fill} />
      ))}
    </g>
  );
}

/** A rolling line of hills from x = -50 to 1250, bumps of height `amp` around y, filled down to `to`. */
export function hills(y: number, amp: number, bumps: number, phase: number, to: number, fill: string): ReactElement {
  const step = 1300 / bumps;
  let d = `M -50 ${to} L -50 ${y}`;
  for (let i = 0; i < bumps; i++) {
    const x0 = -50 + i * step;
    const lift = amp * (0.6 + 0.4 * Math.sin(i * 1.7 + phase));
    d += ` Q ${(x0 + step / 2).toFixed(1)} ${(y - lift * 2).toFixed(1)} ${(x0 + step).toFixed(1)} ${y}`;
  }
  d += ` L 1250 ${to} Z`;
  return <path d={d} fill={fill} />;
}
