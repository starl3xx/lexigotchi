/**
 * Summer: an afternoon on the beach. A deep blue sky warming to haze at the horizon, a soft sun
 * with slow rays, a couple of clouds and gulls, the sea darkening toward the horizon with sun
 * glitter and crests, a small sail far out, and waves washing up the sand and sliding back.
 *
 * Framed at the sides so the word has the middle: a palm leaning in from the right with its fronds
 * swaying over the sky, a striped umbrella planted behind the word at the left with a towel and a
 * beach ball, and in the front right corner a sandcastle with its bucket and spade.
 *
 * Light comes from the sun at the upper left: round things are lit on that side and shaded on the
 * other, and shadows fall to the right on the sand.
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, cloud, lin, rad, scatter, speckles, type Ctx, type Layer } from "../kit";
import { haze, horizon, poly, quad, quadDir, up, type Pt } from "./outdoor";

const CANDY = { light: "#ef7066", mid: "#d8463f", dark: "#a8332d" };
const CREAM = { light: "#fffaf0", mid: "#f3e9d6", dark: "#d6c8ae" };
const TEAL = { light: "#45bfae", mid: "#2a9d8f", dark: "#1a6e64" };
const SAND = { light: "#f6dfa8", mid: "#e9c47f", dark: "#c99a52", deep: "#a87b3c" };

function geom(c: Ctx) {
  const hz = horizon(c) + 20;
  return { hz, shore: c.G - 64, sun: [430, up(hz, 0.34)] as Pt };
}

/** The palm, leaning in from the right edge: a ringed, tapering trunk, coconuts, and swaying fronds. */
function palm(c: Ctx): ReactElement {
  const base: Pt = [1290, c.h + 40];
  const bend: Pt = [1150, c.G - 150];
  const crown: Pt = [1000, Math.max(70, c.G - 410)];
  const steps = 16;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const rings: [Pt, Pt][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = quad(base, bend, crown, t);
    const [dx, dy] = quadDir(base, bend, crown, t);
    const half = 26 - t * 12;
    const n: Pt = [-dy, dx];
    left.push([x + n[0] * half, y + n[1] * half]);
    right.push([x - n[0] * half, y - n[1] * half]);
    if (i > 0 && i < steps) rings.push([left[i], right[i]]);
  }
  // Fronds: a midrib arching out and drooping, lined with leaflets on both sides.
  const fronds = [
    { a: -172, len: 230, droop: 90 },
    { a: -142, len: 250, droop: 70 },
    { a: -112, len: 190, droop: 30 },
    { a: -70, len: 200, droop: 40 },
    { a: -28, len: 240, droop: 80 },
    { a: 8, len: 220, droop: 120 },
    { a: 150, len: 210, droop: 120 },
    { a: 196, len: 200, droop: 150 },
  ];
  const leafs = fronds.map((f, k) => {
    const r = (f.a * Math.PI) / 180;
    const tip: Pt = [crown[0] + Math.cos(r) * f.len, crown[1] + Math.sin(r) * f.len + f.droop];
    const mid: Pt = [crown[0] + Math.cos(r) * f.len * 0.55, crown[1] + Math.sin(r) * f.len * 0.55 - 34];
    const leaflets: { from: Pt; to: Pt; lit: boolean }[] = [];
    for (let i = 2; i <= 13; i++) {
      const t = i / 14;
      const p = quad(crown, mid, tip, t);
      const d = quadDir(crown, mid, tip, t);
      const len = 62 * (1 - t * 0.7);
      for (const side of [1, -1]) {
        const ang = Math.atan2(d[1], d[0]) + side * 0.95;
        leaflets.push({
          from: p,
          to: [p[0] + Math.cos(ang) * len + d[0] * len * 0.35, p[1] + Math.sin(ang) * len + len * 0.45],
          lit: side === (k % 2 ? 1 : -1),
        });
      }
    }
    return { mid, tip, leaflets };
  });
  const sway = c.motion("scn-sweep", 5.5, -1.5, { ox: crown[0], oy: crown[1], deg: "2.2deg" });
  return (
    <g>
      <ellipse cx={1150} cy={c.G + 60} rx={150} ry={22} fill={c.url("shadow")} />
      <path d={poly([...left, ...[...right].reverse()])} fill={c.url("trunk")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {rings.map(([a, b], i) => (
        <path key={i} d={`M ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${((a[0] + b[0]) / 2 + 6).toFixed(1)} ${((a[1] + b[1]) / 2 + 8).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`} fill="none" stroke="#4a2f16" strokeOpacity={0.45} strokeWidth={2.5} />
      ))}
      <path d={poly(left, false)} fill="none" stroke="#e8c48f" strokeOpacity={0.45} strokeWidth={4} />
      <g {...sway}>
        {leafs.map((l, k) => (
          <g key={k}>
            {l.leaflets.map((s, i) => (
              <path
                key={i}
                d={`M ${s.from[0].toFixed(1)} ${s.from[1].toFixed(1)} Q ${((s.from[0] + s.to[0]) / 2).toFixed(1)} ${((s.from[1] + s.to[1]) / 2 - 8).toFixed(1)} ${s.to[0].toFixed(1)} ${s.to[1].toFixed(1)}`}
                fill="none"
                stroke={s.lit ? "#3fae6d" : "#22744a"}
                strokeWidth={9}
                strokeLinecap="round"
              />
            ))}
            <path d={`M ${crown[0]} ${crown[1]} Q ${l.mid[0].toFixed(1)} ${l.mid[1].toFixed(1)} ${l.tip[0].toFixed(1)} ${l.tip[1].toFixed(1)}`} fill="none" stroke="#1b5a38" strokeWidth={5} strokeLinecap="round" />
            <path d={`M ${crown[0]} ${crown[1]} Q ${l.mid[0].toFixed(1)} ${(l.mid[1] - 3).toFixed(1)} ${l.tip[0].toFixed(1)} ${(l.tip[1] - 3).toFixed(1)}`} fill="none" stroke="#8fd8a0" strokeOpacity={0.5} strokeWidth={1.5} strokeLinecap="round" />
          </g>
        ))}
        {[
          [-14, 14],
          [12, 18],
          [-1, 30],
        ].map(([dx, dy], i) => (
          <g key={`n${i}`}>
            <circle cx={crown[0] + dx} cy={crown[1] + dy} r={15} fill={c.url("coconut")} stroke={INK} strokeWidth={2.5} />
            <circle cx={crown[0] + dx - 5} cy={crown[1] + dy - 5} r={4} fill="#ffffff" opacity={0.3} />
          </g>
        ))}
      </g>
    </g>
  );
}

/** The striped umbrella, planted behind the word at the left: a domed canopy with a scalloped hem. */
function umbrella(c: Ctx): ReactElement {
  const apex: Pt = [112, c.G - 292];
  const hem = c.G - 214;
  const L = -36;
  const R = 262;
  const panels = 6;
  const xs = Array.from({ length: panels + 1 }, (_, i) => L + ((R - L) * i) / panels);
  const panel = (i: number) => {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const c0: Pt = [apex[0] + (x0 - apex[0]) * 0.72, apex[1] + (hem - apex[1]) * 0.08];
    const c1: Pt = [apex[0] + (x1 - apex[0]) * 0.72, apex[1] + (hem - apex[1]) * 0.08];
    return `M ${apex[0]} ${apex[1]} Q ${c0[0].toFixed(1)} ${c0[1].toFixed(1)} ${x0.toFixed(1)} ${hem} Q ${((x0 + x1) / 2).toFixed(1)} ${hem + 22} ${x1.toFixed(1)} ${hem} Q ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${apex[0]} ${apex[1]} Z`;
  };
  return (
    <g>
      <ellipse cx={190} cy={c.G - 26} rx={170} ry={22} fill={c.url("shadow")} />
      {/* the towel under it, in perspective: stripes along its length, a fringe at the front */}
      <path d={`M -20 ${c.G - 52} L 200 ${c.G - 52} L 222 ${c.G + 2} L -40 ${c.G + 2} Z`} fill={TEAL.mid} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {[0.3, 0.6].map((t) => (
        <path key={t} d={`M ${-20 + 220 * t} ${c.G - 52} L ${-40 + 262 * t} ${c.G + 2}`} stroke={CREAM.light} strokeWidth={14} />
      ))}
      <path d={`M -20 ${c.G - 52} L 200 ${c.G - 52} L 204 ${c.G - 44} L -24 ${c.G - 44} Z`} fill="#ffffff" opacity={0.18} />
      {Array.from({ length: 13 }, (_, i) => (
        <line key={i} x1={-30 + i * 19} y1={c.G + 2} x2={-31 + i * 19} y2={c.G + 11} stroke={TEAL.dark} strokeWidth={3} strokeLinecap="round" />
      ))}
      {/* the pole, then the canopy: lit panels on the left, shaded on the right, a darker underside below the hem */}
      <line x1={150} y1={c.G - 30} x2={apex[0]} y2={apex[1] + 8} stroke={INK} strokeWidth={9} strokeLinecap="round" />
      <line x1={149} y1={c.G - 32} x2={apex[0] - 1} y2={apex[1] + 10} stroke={CREAM.mid} strokeWidth={4} strokeLinecap="round" />
      <path
        d={`M ${L} ${hem} ${xs
          .slice(1)
          .map((x, i) => `Q ${((xs[i] + x) / 2).toFixed(1)} ${hem + 30} ${x.toFixed(1)} ${hem}`)
          .join(" ")}`}
        fill="none"
        stroke="#7a2a24"
        strokeOpacity={0.55}
        strokeWidth={7}
      />
      {Array.from({ length: panels }, (_, i) => {
        const right = i >= panels / 2;
        const fill = i % 2 ? c.url(right ? "creamR" : "creamL") : c.url(right ? "candyR" : "candyL");
        return <path key={i} d={panel(i)} fill={fill} stroke={INK} strokeWidth={3} strokeLinejoin="round" />;
      })}
      <path d={`M ${apex[0] - 6} ${apex[1] + 6} Q ${apex[0] - 90} ${apex[1] + 10} ${L + 22} ${hem - 14}`} fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={5} strokeLinecap="round" />
      <circle cx={apex[0]} cy={apex[1] - 4} r={8} fill={CANDY.dark} stroke={INK} strokeWidth={3} />
    </g>
  );
}

/** A beach ball in three colors, lit at the upper left, with its shadow to the right. */
function beachBall(c: Ctx, cx: number, cy: number, r: number): ReactElement {
  const top = cy - r;
  const bot = cy + r;
  const lune = (k0: number, k1: number) => `M ${cx} ${top} Q ${cx + k0 * r * 1.35} ${cy} ${cx} ${bot} Q ${cx + k1 * r * 1.35} ${cy} ${cx} ${top} Z`;
  return (
    <g>
      <ellipse cx={cx + r * 0.6} cy={cy + r * 0.9} rx={r * 1.2} ry={r * 0.28} fill={c.url("shadow")} />
      <circle cx={cx} cy={cy} r={r} fill={CREAM.light} />
      <path d={lune(-1, -0.38)} fill={CANDY.mid} />
      <path d={lune(0.38, 1)} fill={TEAL.mid} />
      <circle cx={cx} cy={cy} r={r} fill={c.url("ballShade")} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK} strokeWidth={3} />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.42} rx={r * 0.22} ry={r * 0.14} fill="#ffffff" opacity={0.75} transform={`rotate(-30 ${cx - r * 0.35} ${cy - r * 0.42})`} />
      <circle cx={cx} cy={top + 3} r={4} fill="#f0c04a" stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

/** The sandcastle in the front right corner: a keep between two round towers, with its bucket and spade. */
function sandcastle(c: Ctx, x: number, y: number, s: number): ReactElement {
  const bumps = (x0: number, x1: number, top: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const w = (x1 - x0) / n;
      return <path key={i} d={`M ${x0 + i * w + 2} ${top + 1} Q ${x0 + i * w + w / 2} ${top - 13} ${x0 + (i + 1) * w - 2} ${top + 1} Z`} fill={c.url("castle")} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />;
    });
  const tower = (tx: number, w: number, top: number) => (
    <g>
      <path d={`M ${tx} 0 L ${tx} ${top} Q ${tx + w / 2} ${top - 10} ${tx + w} ${top} L ${tx + w} 0 Z`} fill={c.url("castle")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <ellipse cx={tx + w / 2} cy={top} rx={w / 2} ry={7} fill={SAND.light} stroke={INK} strokeWidth={2.5} />
      {bumps(tx - 2, tx + w + 2, top - 2, 3)}
      <path d={`M ${tx + w / 2 - 6} ${top + 34} L ${tx + w / 2 - 6} ${top + 26} Q ${tx + w / 2} ${top + 19} ${tx + w / 2 + 6} ${top + 26} L ${tx + w / 2 + 6} ${top + 34} Z`} fill={SAND.deep} />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={30} cy={6} rx={150} ry={20} fill={c.url("shadow")} />
      <path d="M -112 6 Q -100 -16 -60 -18 L 70 -18 Q 108 -16 118 6 Z" fill={SAND.mid} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {tower(-92, 46, -118)}
      {tower(48, 46, -112)}
      <path d="M -50 -18 L -50 -82 L 52 -82 L 52 -18 Z" fill={c.url("castle")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {bumps(-52, 54, -82, 5)}
      <path d="M -14 -18 L -14 -44 Q 1 -62 16 -44 L 16 -18 Z" fill={SAND.deep} stroke={INK} strokeWidth={2.5} />
      {/* drips of wet sand down the walls, and a shell set in the keep */}
      {[-40, -26, 28, 40].map((dx, i) => (
        <path key={i} d={`M ${dx} -80 q 3 ${8 + (i % 2) * 6} 0 ${14 + (i % 2) * 8}`} fill="none" stroke={SAND.dark} strokeWidth={2.5} strokeLinecap="round" />
      ))}
      <path d="M -36 -58 q 6 -10 12 0 q -6 4 -12 0 Z" fill="#f6c3d3" stroke={INK} strokeWidth={1.5} />
      {speckles(73, 46, [-110, -128, 110, 2], [SAND.dark, SAND.light], [0.9, 1.8], 0.6)}
      <line x1={71} y1={-124} x2={71} y2={-172} stroke={INK} strokeWidth={3.5} />
      <path d="M 73 -172 L 104 -163 L 73 -152 Z" fill={CANDY.mid} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" {...c.motion("scn-flutter", 0.9, 0)} />
      {/* the bucket and the spade */}
      <g transform="translate(-168 4)">
        <path d="M -26 -52 L 26 -52 L 20 0 L -20 0 Z" fill={c.url("bucket")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <ellipse cx={0} cy={-52} rx={26} ry={7} fill={TEAL.dark} stroke={INK} strokeWidth={2.5} />
        <path d="M -24 -50 Q 0 -96 24 -50" fill="none" stroke={INK} strokeWidth={3} />
        <rect x={-18} y={-46} width={6} height={40} rx={3} fill="#ffffff" opacity={0.35} />
      </g>
      <g transform="translate(140 8) rotate(16)">
        <rect x={-4} y={-98} width={8} height={70} rx={3} fill="#c99a52" stroke={INK} strokeWidth={2.5} />
        <path d="M -16 -30 L 16 -30 L 12 0 Q 0 8 -12 0 Z" fill={CANDY.mid} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** A scallop shell and a spiral shell, small, on the sand. */
function shells(c: Ctx): ReactElement {
  const scallop = (x: number, y: number, col: string, s: number) => (
    <g key={`s${x}`} transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={3} cy={4} rx={13} ry={3} fill={c.url("shadow")} />
      <path d="M 0 2 L -12 -6 Q -12 -16 0 -18 Q 12 -16 12 -6 Z" fill={col} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      {[-8, -4, 0, 4, 8].map((dx) => (
        <line key={dx} x1={0} y1={1} x2={dx} y2={-15} stroke={INK} strokeOpacity={0.3} strokeWidth={1.1} />
      ))}
    </g>
  );
  return (
    <g>
      {scallop(560, c.G + 118, "#f6c3d3", 1)}
      {scallop(880, c.G + 90, "#fbf1dc", 0.8)}
      <g transform={`translate(470 ${c.G + 96}) rotate(-18)`}>
        <ellipse cx={4} cy={6} rx={14} ry={3} fill={c.url("shadow")} />
        <path d="M -12 2 Q -10 -10 2 -10 Q 14 -8 12 2 Q 4 8 -12 2 Z" fill="#f0d2a8" stroke={INK} strokeWidth={1.8} />
        <path d="M 2 -10 Q 8 -4 2 0 Q -3 -3 1 -6" fill="none" stroke={INK} strokeOpacity={0.4} strokeWidth={1.2} />
      </g>
    </g>
  );
}

export const summerBack: Layer = (c) => {
  const { hz, shore, sun } = geom(c);
  // Sun glitter on the water: narrow at the horizon, widening toward the shore.
  const glitter = scatter(12, 30, (r) => {
    const t = r.next();
    return { x: sun[0] + (r.next() - 0.5) * (30 + t * 220), y: hz + 5 + t * (shore - hz - 12), w: 8 + t * 28, d: -r.next() * 3 };
  });
  const crests = scatter(13, 22, (r) => {
    const t = Math.pow(r.next(), 1.4);
    return { x: r.next() * SCENE_W, y: hz + 8 + t * (shore - hz - 16), w: 24 + t * 80 };
  });
  return (
    <g>
      <defs>
        {lin(c.id("sky"), [[0, "#1d87cf"], [0.5, "#4fb0e2"], [0.85, "#a9def0"], [1, "#f2ecd2"]])}
        {rad(c.id("sunGlow"), [[0, "#fffbe0", 0.95], [0.3, "#fff3b8", 0.55], [1, "#fff3b8", 0]])}
        {rad(c.id("sunDisk"), [[0, "#fffef4"], [0.65, "#fff4bf"], [1, "#ffe07a"]])}
        {/* the rays fade outward from the sun: one gradient in scene units, centered on it (the rays turn about that point) */}
        <radialGradient id={c.id("ray")} gradientUnits="userSpaceOnUse" cx={sun[0]} cy={sun[1]} r={200}>
          <stop offset={0.35} stopColor="#fff8d8" stopOpacity={0.3} />
          <stop offset={1} stopColor="#fff8d8" stopOpacity={0} />
        </radialGradient>
        {lin(c.id("sea"), [[0, "#0f5b86"], [0.35, "#1782ab"], [0.75, "#2bb0c2"], [1, "#5ccfca"]])}
        {lin(c.id("shallow"), [[0, "#74ddd2", 0], [1, "#9cecdf", 0.8]])}
        {lin(c.id("wash"), [[0, "#c6f4ea", 0.85], [1, "#c6f4ea", 0.15]])}
        {lin(c.id("sand"), [[0, SAND.light], [0.45, "#efd093"], [1, "#dfb36c"]])}
        {lin(c.id("wet"), [[0, "#c69c60", 0.85], [1, "#c69c60", 0]])}
        {rad(c.id("shadow"), [[0, "#6e4f22", 0.38], [1, "#6e4f22", 0]])}
        {lin(c.id("trunk"), [[0, "#b48a58"], [0.45, "#8f673c"], [1, "#5a3c20"]], true)}
        {rad(c.id("coconut"), [[0, "#8a5a2e"], [1, "#4f3016"]])}
        {lin(c.id("candyL"), [[0, CANDY.light], [1, CANDY.mid]], true)}
        {lin(c.id("candyR"), [[0, CANDY.mid], [1, CANDY.dark]], true)}
        {lin(c.id("creamL"), [[0, CREAM.light], [1, CREAM.mid]], true)}
        {lin(c.id("creamR"), [[0, CREAM.mid], [1, CREAM.dark]], true)}
        {rad(c.id("ballShade"), [[0.55, INK, 0], [1, INK, 0.3]])}
        {lin(c.id("castle"), [[0, "#f6dca4"], [0.55, SAND.mid], [1, SAND.dark]], true)}
        {lin(c.id("bucket"), [[0, TEAL.light], [0.5, TEAL.mid], [1, TEAL.dark]], true)}
      </defs>

      {/* the sky, the sun and its slow rays, clouds, gulls */}
      <rect x={0} y={0} width={SCENE_W} height={hz + 2} fill={c.url("sky")} />
      <circle cx={sun[0]} cy={sun[1]} r={230} fill={c.url("sunGlow")} />
      <g {...c.motion("scn-spin", 90, 0)}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const p = (d: number, da: number) => `${(sun[0] + Math.cos(a + da) * d).toFixed(1)} ${(sun[1] + Math.sin(a + da) * d).toFixed(1)}`;
          return <path key={i} d={`M ${p(74, -0.1)} L ${p(190, -0.045)} L ${p(190, 0.045)} L ${p(74, 0.1)} Z`} fill={c.url("ray")} />;
        })}
      </g>
      <circle cx={sun[0]} cy={sun[1]} r={96} fill="none" stroke="#fff6c8" strokeOpacity={0.3} strokeWidth={16} />
      <circle cx={sun[0]} cy={sun[1]} r={58} fill={c.url("sunDisk")} />
      {[
        [720, up(hz, 0.2), 0.62, 0],
        [170, up(hz, 0.52), 0.5, -9],
      ].map(([x, y, s, d], i) => (
        <g key={i} {...c.motion("scn-drift", 34 + i * 8, d, { dx: 30 })}>
          {cloud(x, y, s)}
        </g>
      ))}
      {[
        [620, up(hz, 0.44), 0],
        [672, up(hz, 0.5), -1.2],
      ].map(([x, y, d], i) => (
        <g key={`g${i}`} transform={`translate(${x} ${y})`}>
          <g {...c.motion("scn-drift", 11, d, { dx: 40 })}>
            <path d="M -20 3 Q -12 -8 -2 0 L 0 2 L 2 0 Q 12 -8 20 3 Q 11 -3 0 5 Q -11 -3 -20 3 Z" fill="#3a4653" {...c.motion("scn-bob", 1.5, d, { dy: -5 })} />
          </g>
        </g>
      ))}

      {/* the sea: deep at the horizon, turquoise in the shallows, glitter under the sun, crests */}
      <rect x={0} y={hz} width={SCENE_W} height={shore - hz + 12} fill={c.url("sea")} />
      {haze(c, hz, 26, "#eaf8fb", 0.75)}
      <rect x={0} y={hz} width={SCENE_W} height={2} fill="#ffffff" opacity={0.55} />
      <rect x={0} y={shore - 42} width={SCENE_W} height={54} fill={c.url("shallow")} />
      {crests.map((w, i) => (
        <path key={i} d={`M ${w.x.toFixed(1)} ${w.y.toFixed(1)} q ${(w.w / 2).toFixed(1)} -5 ${w.w.toFixed(1)} 0`} fill="none" stroke="#ecfbff" strokeOpacity={0.45} strokeWidth={2.5} strokeLinecap="round" />
      ))}
      {glitter.map((g, i) => (
        <rect key={`gl${i}`} x={g.x.toFixed(1)} y={g.y.toFixed(1)} width={g.w.toFixed(1)} height={3} rx={1.5} fill="#ffffff" opacity={0.8} {...c.motion("scn-twinkle", 1.8, g.d)} />
      ))}
      {/* a small sail far out, between the word and the palm */}
      <g transform={`translate(1050 ${hz + 14}) scale(0.62)`}>
        <g {...c.motion("scn-bob", 2.8, 0, { dy: -4 })}>
          <path d="M -30 0 L 30 0 L 22 10 L -22 10 Z" fill="#ffffff" stroke={INK} strokeWidth={3} />
          <line x1={0} y1={0} x2={0} y2={-60} stroke={INK} strokeWidth={3} />
          <path d="M 2 -58 L 28 -6 L 2 -6 Z" fill={CREAM.light} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d="M -2 -48 L -22 -6 L -2 -6 Z" fill={CANDY.mid} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        </g>
      </g>

      {/* the sand: a wet band at the water's edge, ripples, grains */}
      <rect x={0} y={shore} width={SCENE_W} height={c.h - shore} fill={c.url("sand")} />
      <rect x={0} y={shore} width={SCENE_W} height={46} fill={c.url("wet")} />
      {Array.from({ length: 6 }, (_, i) => {
        const y = shore + 58 + i * ((c.h - shore - 58) / 6);
        return <path key={i} d={`M -20 ${y.toFixed(1)} Q 150 ${(y - 7).toFixed(1)} 300 ${y.toFixed(1)} T 600 ${y.toFixed(1)} T 900 ${y.toFixed(1)} T 1220 ${y.toFixed(1)}`} fill="none" stroke={SAND.dark} strokeOpacity={0.2} strokeWidth={2.5} />;
      })}
      {speckles(61, 190, [0, shore + 30, SCENE_W, c.h], [SAND.dark, "#fff6dc", SAND.deep], [1, 2.6], 0.6)}
      {/* a wave washing up the sand and sliding back: a sheet of clear water with a lacy foam edge */}
      <g {...c.motion("scn-bob", 4.2, 0, { dy: 9 })}>
        <path
          d={`M -20 ${shore - 4} L 1220 ${shore - 4} L 1220 ${shore + 18} Q 1060 ${shore + 30} 900 ${shore + 20} T 600 ${shore + 22} T 300 ${shore + 18} T -20 ${shore + 24} Z`}
          fill={c.url("wash")}
        />
        <path
          d={`M -20 ${shore + 24} Q 140 ${shore + 14} 300 ${shore + 18} T 600 ${shore + 22} T 900 ${shore + 20} T 1220 ${shore + 18}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray="22 6 8 6"
          opacity={0.95}
        />
      </g>
      <g {...c.motion("scn-drift", 6, -2, { dx: 16 })}>
        <path d={`M -40 ${shore + 2} Q 60 ${shore + 10} 160 ${shore + 2} T 360 ${shore + 2} T 560 ${shore + 2} T 760 ${shore + 2} T 960 ${shore + 2} T 1160 ${shore + 2} T 1360 ${shore + 2}`} fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.7} />
      </g>

      {umbrella(c)}
      {beachBall(c, 96, c.G + 96, 34)}
      {shells(c)}
      <g transform={`translate(700 ${c.G + 124}) rotate(14) scale(0.72)`}>
        <ellipse cx={6} cy={8} rx={30} ry={6} fill={c.url("shadow")} />
        <path d="M 0 -30 Q 5 -12 9 -9 Q 22 -9 30 -6 Q 20 2 13 9 Q 16 22 19 30 Q 6 24 0 18 Q -6 24 -19 30 Q -16 22 -13 9 Q -20 2 -30 -6 Q -22 -9 -9 -9 Q -5 -12 0 -30 Z" fill="#f08a4b" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        {[
          [0, -16],
          [12, -4],
          [-12, -4],
          [8, 12],
          [-8, 12],
          [0, 0],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.2} fill="#ffd2a8" />
        ))}
      </g>
      {sandcastle(c, 1056, c.G + 112, 0.82)}
      {palm(c)}
    </g>
  );
};
