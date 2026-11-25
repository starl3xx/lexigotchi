/**
 * Spring and Fall, outdoors (Summer and Winter have files of their own). Each has a sky, a horizon
 * a little above the word, ground that runs toward the viewer, its own landmarks at the sides (so
 * the middle stays clear for the word), and one kind of weather: blossom petals, falling leaves.
 *
 * Depth and texture: far things are paler and hazier than near ones (a haze band sits on every
 * horizon), every round form is lit from the upper left (kit.tsx's canopy and cloud), and the
 * ground carries small marks that grow toward the viewer: grass blades, stubble, fallen leaves.
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, canopy, cloud, fallers, hills, lin, rad, scatter, speckles, type Ctx, type Layer } from "../kit";
import { haze, horizon, tufts, up } from "./outdoor";

/** A tree trunk with two boughs, lit on its left, from (0, 0) up. */
function trunk(c: Ctx, color: string, h = 240): ReactElement {
  return (
    <g>
      <path d={`M -18 0 Q -10 -${h * 0.54} -26 -${h} L 6 -${h} Q 14 -${h * 0.54} 20 0 Z`} fill={color} stroke={INK} strokeWidth={3} />
      <path d={`M -10 -4 Q -4 -${h * 0.5} -16 -${h * 0.96}`} fill="none" stroke="#ffffff" strokeOpacity={0.18} strokeWidth={5} />
      {[0.2, 0.38, 0.6].map((f) => (
        <path key={f} d={`M ${-6 + f * 10} -${h * f} q 6 -10 2 -22`} fill="none" stroke={INK} strokeOpacity={0.3} strokeWidth={2} />
      ))}
      <path d={`M -12 -${h * 0.66} Q -70 -${h * 0.83} -100 -${h * 1.04} M 4 -${h * 0.75} Q 60 -${h * 0.92} 96 -${h * 1.12}`} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Spring: blossom trees, a meadow of flowers, a pale rainbow, petals on the breeze, butterflies.
// ---------------------------------------------------------------------------------------------

const PINKS = ["#f7b6c8", "#f29bb4", "#fde0e8", "#f6c3d3", "#ec8aa6"];
const BLOSSOM: [string, string, string, string] = ["#d97a98", "#f29bb4", "#f8c6d6", "#fdebf1"];

function blossomTree(c: Ctx, x: number, base: number, s: number, seed: number): ReactElement {
  return (
    <g transform={`translate(${x} ${base}) scale(${s})`}>
      <ellipse cx={10} cy={4} rx={130} ry={18} fill="#2f6b2a" opacity={0.22} />
      {trunk(c, "#6b4226", 232)}
      <g {...c.motion("scn-sway", 7, -seed)}>{canopy(seed, 0, -262, 165, 104, BLOSSOM, 40)}</g>
    </g>
  );
}

function daisy(x: number, y: number, s: number): ReactElement {
  return (
    <g key={`d${x}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <path d="M 0 0 Q 2 -12 0 -22" stroke="#3e8a3a" strokeWidth={3} fill="none" />
      {Array.from({ length: 7 }, (_, i) => (
        <ellipse key={i} cx={0} cy={-31} rx={4} ry={9} transform={`rotate(${i * (360 / 7)} 0 -24)`} fill={i < 3 ? "#ffffff" : "#eef1f6"} />
      ))}
      <circle cx={0} cy={-24} r={5} fill="#f0a617" />
      <circle cx={-1.5} cy={-25.5} r={2} fill="#ffd66b" />
    </g>
  );
}

function tulip(x: number, y: number, s: number, color: string): ReactElement {
  return (
    <g key={`t${x}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})`}>
      <path d="M 0 0 L 0 -30" stroke="#3e8a3a" strokeWidth={3.5} />
      <path d="M 0 -6 Q 12 -14 12 -30 Q 4 -20 0 -14" fill="#4f9e44" />
      <path d="M -10 -44 L -5 -36 L 0 -46 L 5 -36 L 10 -44 L 10 -32 Q 0 -22 -10 -32 Z" fill={color} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M -6 -40 Q -6 -32 -2 -29" fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={2} />
    </g>
  );
}

function butterfly(c: Ctx, x: number, y: number, color: string, delay: number): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g {...c.motion("scn-drift", 7, delay, { dx: 60 })}>
        <g {...c.motion("scn-bob", 1.7, delay, { dy: -22 })}>
          <g {...c.motion("scn-flutter", 0.22, delay)}>
            <ellipse cx={-11} cy={-6} rx={12} ry={9} fill={color} stroke={INK} strokeWidth={2} />
            <ellipse cx={11} cy={-6} rx={12} ry={9} fill={color} stroke={INK} strokeWidth={2} />
            <ellipse cx={-8} cy={7} rx={8} ry={6} fill={color} stroke={INK} strokeWidth={2} />
            <ellipse cx={8} cy={7} rx={8} ry={6} fill={color} stroke={INK} strokeWidth={2} />
            <circle cx={-12} cy={-7} r={3} fill="#ffffff" opacity={0.6} />
            <circle cx={12} cy={-7} r={3} fill="#ffffff" opacity={0.6} />
          </g>
          <rect x={-2.5} y={-12} width={5} height={24} rx={2.5} fill={INK} />
        </g>
      </g>
    </g>
  );
}

export const springBack: Layer = (c) => {
  const hz = horizon(c);
  const bands = ["#ff9a9a", "#ffc58a", "#ffe98a", "#a6e6a0", "#97cdff", "#c6adff"];
  // Flowers fill the sides. In the middle, where the word stands, they grow only behind its feet
  // or well in front of them, so none is drawn behind a character it should stand in front of.
  const flowers = scatter(31, 30, (r) => {
    const middle = r.next() < 0.3;
    const y = middle
      ? r.next() < 0.5
        ? hz + 70 + r.next() * Math.max(0, c.G - 30 - hz - 70)
        : c.G + 70 + r.next() * (c.h - c.G - 70)
      : hz + 70 + r.next() * (c.h - hz - 70);
    const s = 0.55 + ((y - hz) / (c.h - hz)) * 0.9;
    const x = middle ? 260 + r.next() * 680 : r.next() < 0.5 ? r.next() * 260 : 940 + r.next() * 260;
    return { x, y, s, kind: r.next() < 0.55 ? "d" : "t", color: ["#d8463f", "#e0a93b", "#ec8aa6"][r.int(3)] };
  }).sort((a, b) => a.y - b.y);
  const farTrees = scatter(41, 9, (r) => ({ x: 60 + r.next() * 1080, y: hz + 6 + r.next() * 20, s: 0.6 + r.next() * 0.5 }));
  return (
    <g>
      <defs>
        {lin(c.id("sky"), [[0, "#79bfea"], [0.7, "#bfe4f3"], [1, "#e6f6ef"]])}
        {rad(c.id("sun"), [[0, "#fff7c2", 0.9], [1, "#fff7c2", 0]])}
        {lin(c.id("far"), [[0, "#d3ecb0"], [1, "#b6db90"]])}
        {lin(c.id("near"), [[0, "#b4e088"], [1, "#8cc566"]])}
        {lin(c.id("meadow"), [[0, "#9bd26a"], [0.5, "#79bd52"], [1, "#4f9a3d"]])}
        {rad(c.id("sunPatch"), [[0, "#eaffb8", 0.4], [1, "#eaffb8", 0]])}
        {rad(c.id("cloudShade"), [[0, "#2f6b2a", 0.22], [1, "#2f6b2a", 0]])}
      </defs>
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("sky")} />
      <circle cx={170} cy={80} r={200} fill={c.url("sun")} />
      {/* high wisps, a pale rainbow, and puffy clouds drifting */}
      {[
        [520, up(hz, 0.18), 260],
        [880, up(hz, 0.5), 200],
        [320, up(hz, 0.66), 180],
      ].map(([x, y, w], i) => (
        <ellipse key={i} cx={x} cy={y} rx={w} ry={9} fill="#ffffff" opacity={0.35} />
      ))}
      {bands.map((col, i) => {
        const r = 640 - i * 20;
        return <path key={i} d={`M ${640 - r} ${hz + 40} A ${r} ${r} 0 0 1 ${640 + r} ${hz + 40}`} fill="none" stroke={col} strokeOpacity={0.3} strokeWidth={20} />;
      })}
      {[
        [300, up(hz, 0.42), 0.85, 0],
        [880, up(hz, 0.26), 1.05, -6],
        [1120, up(hz, 0.62), 0.6, -3],
      ].map(([x, y, s, d], i) => (
        <g key={i} {...c.motion("scn-drift", 26 + i * 6, d, { dx: 40 })}>
          {cloud(x, y, s)}
        </g>
      ))}
      {/* far hills with little trees, hazy; nearer hills; the meadow */}
      {hills(hz, 40, 5, 0.3, c.h, c.url("far"))}
      {farTrees.map((t, i) => (
        <g key={i} transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) scale(${t.s.toFixed(2)})`}>
          <circle cx={-7} cy={-8} r={9} fill="#7fae5c" />
          <circle cx={6} cy={-11} r={11} fill="#8dbb66" />
          <circle cx={2} cy={-4} r={9} fill="#76a453" />
        </g>
      ))}
      {haze(c, hz + 8, 70, "#f4fbf2", 0.6)}
      {hills(hz + 34, 30, 4, 1.4, c.h, c.url("near"))}
      <rect x={0} y={hz + 70} width={SCENE_W} height={c.h - hz - 70} fill={c.url("meadow")} />
      {/* sunlit patches and a cloud's shadow passing over the meadow */}
      <ellipse cx={420} cy={hz + 110} rx={320} ry={40} fill={c.url("sunPatch")} />
      <ellipse cx={980} cy={c.G + 60} rx={260} ry={46} fill={c.url("cloudShade")} />
      {speckles(12, 70, [0, hz + 72, SCENE_W, c.G - 20], ["#ffffff", "#ffe27a", "#f7b6c8"], [1.2, 3])}
      {tufts(c, 3, 90, ["#3f8a3a", "#4d9a42", "#62ad4c", "#2f7430"])}
      {blossomTree(c, 120, c.G + 40, 1.05, 2)}
      {blossomTree(c, 1110, c.G - 10, 0.75, 5)}
      {/* petals already fallen under the trees */}
      {speckles(51, 26, [20, c.G + 40, 300, c.G + 90], PINKS, [2, 4])}
      {speckles(52, 16, [1000, c.G - 4, 1200, c.G + 30], PINKS, [1.6, 3])}
      {flowers.map((f) => (f.kind === "d" ? daisy(f.x, f.y, f.s) : tulip(f.x, f.y, f.s, f.color)))}
    </g>
  );
};

export const springFront: Layer = (c) => (
  <g>
    {fallers(c, 5, 22, {
      dur: [10, 16],
      swing: [20, 50],
      draw: (r) => (
        <g>
          <ellipse rx={7} ry={4.5} fill={PINKS[r.int(PINKS.length)]} stroke="#d06a8a" strokeOpacity={0.5} strokeWidth={1} />
          <ellipse cx={-2} cy={-1} rx={3} ry={1.5} fill="#ffffff" opacity={0.5} />
        </g>
      ),
    })}
    {/* butterflies keep to the open sky and the meadow's edges, clear of the word */}
    {butterfly(c, 470, c.G - 290, "#f0a617", 0)}
    {butterfly(c, 1060, c.G + 60, "#97cdff", -3)}
  </g>
);

// ---------------------------------------------------------------------------------------------
// Fall: golden-hour sky with long lit clouds and a low sun, geese heading south, a tree line in
// autumn colors, a stubble field strewn with leaves, a rail fence, a maple and a birch, leaf piles
// and pumpkins, and leaves coming down.
// ---------------------------------------------------------------------------------------------

const AUTUMN = ["#d9482b", "#e8792f", "#f2a93b", "#c23a26", "#f2c14e"];
const MAPLE: [string, string, string, string] = ["#9e2d1c", "#d9482b", "#f07a3a", "#ffb35c"];
const BIRCH: [string, string, string, string] = ["#c08419", "#f2c14e", "#f8d97a", "#fff0b0"];

function autumnTree(c: Ctx, x: number, base: number, s: number, seed: number, tones: [string, string, string, string]): ReactElement {
  return (
    <g transform={`translate(${x} ${base}) scale(${s})`}>
      <ellipse cx={14} cy={4} rx={140} ry={18} fill="#5a3a16" opacity={0.25} />
      {trunk(c, "#5a3a22", 240)}
      <g {...c.motion("scn-sway", 8, -seed)}>{canopy(seed, 0, -270, 150, 112, tones, 38)}</g>
    </g>
  );
}

function leafPile(x: number, y: number, s: number, seed: number): ReactElement {
  const leaves = scatter(seed, 34, (r) => ({ x: (r.next() - 0.5) * 160, y: -Math.pow(r.next(), 1.6) * 46, a: r.next() * 180, fill: AUTUMN[r.int(AUTUMN.length)] }));
  leaves.sort((a, b) => b.y - a.y);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={4} cy={6} rx={104} ry={18} fill="#5a3a16" opacity={0.3} />
      <ellipse cx={0} cy={0} rx={96} ry={20} fill="#8a4f1f" />
      {leaves.map((l, i) => (
        <ellipse key={i} cx={l.x.toFixed(1)} cy={l.y.toFixed(1)} rx={14} ry={8} transform={`rotate(${l.a.toFixed(0)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`} fill={l.fill} stroke={INK} strokeOpacity={0.3} strokeWidth={1.5} />
      ))}
    </g>
  );
}

function pumpkin(c: Ctx, x: number, y: number, s: number): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={6} cy={6} rx={58} ry={10} fill={INK} opacity={0.2} />
      <ellipse cx={-22} cy={-30} rx={28} ry={32} fill="#c75a22" stroke={INK} strokeWidth={3} />
      <ellipse cx={22} cy={-30} rx={28} ry={32} fill="#b84f1d" stroke={INK} strokeWidth={3} />
      <ellipse cx={0} cy={-31} rx={26} ry={34} fill={c.url("pumpkin")} stroke={INK} strokeWidth={3} />
      <path d="M -36 -50 Q -42 -30 -36 -10" fill="none" stroke="#ffb067" strokeOpacity={0.5} strokeWidth={4} strokeLinecap="round" />
      <path d="M -10 -58 Q -14 -32 -10 -6" fill="none" stroke="#ffc58a" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" />
      <path d="M -2 -62 Q 0 -78 10 -84" stroke="#4a6b2e" strokeWidth={8} fill="none" strokeLinecap="round" />
      <path d="M 4 -70 Q 22 -74 26 -60" stroke="#4a6b2e" strokeWidth={2.5} fill="none" />
    </g>
  );
}

function leaf(fill: string): ReactElement {
  return (
    <g>
      <path d="M 0 -12 Q 10 -4 0 12 Q -10 -4 0 -12 Z" fill={fill} stroke={INK} strokeOpacity={0.45} strokeWidth={1.5} />
      <line x1={0} y1={-10} x2={0} y2={10} stroke={INK} strokeOpacity={0.35} strokeWidth={1.2} />
      <path d="M -3 -6 Q -5 -2 -3 2" fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.5} />
    </g>
  );
}

export const fallBack: Layer = (c) => {
  const hz = horizon(c);
  const sun = { x: 790, y: hz - 70 };
  const backLine = scatter(15, 22, (r, i) => ({ x: -30 + i * 60 + r.next() * 24, r: 26 + r.next() * 20, fill: ["#dcae86", "#d3a07a", "#e0b991"][r.int(3)] }));
  const line = scatter(14, 20, (r, i) => ({ x: -40 + i * 66 + r.next() * 30, r: 34 + r.next() * 26, fill: ["#c9763b", "#b5592f", "#d79a3d", "#9c6a34"][r.int(4)] }));
  const posts = Array.from({ length: 13 }, (_, i) => -20 + i * 104);
  const fy = c.G - 46;
  const groundLeaves = scatter(19, 46, (r) => {
    const t = r.next();
    return { x: r.next() * SCENE_W, y: hz + 80 + t * (c.h - hz - 80), a: r.next() * 180, s: 0.5 + t * 0.7, fill: AUTUMN[r.int(AUTUMN.length)] };
  });
  return (
    <g>
      <defs>
        {lin(c.id("sky"), [[0, "#e48b54"], [0.55, "#f4bf86"], [1, "#fde3b3"]])}
        {rad(c.id("sun"), [[0, "#fff4d2", 0.95], [0.4, "#ffe6a8", 0.6], [1, "#ffe6a8", 0]])}
        {lin(c.id("hill"), [[0, "#e2b66a"], [1, "#c99343"]])}
        {lin(c.id("field"), [[0, "#d6a552"], [0.5, "#bd8a3c"], [1, "#94601f"]])}
        {rad(c.id("warm"), [[0, "#ffd58a", 0.45], [1, "#ffd58a", 0]])}
        {lin(c.id("cloud"), [[0, "#f3a38a"], [0.7, "#f9c79c"], [1, "#ffe2b0"]])}
        {rad(c.id("pumpkin"), [[0, "#ffa24f"], [0.6, "#e8792f"], [1, "#c25a1f"]])}
        {lin(c.id("rail"), [[0, "#a37748"], [0.4, "#7d5833"], [1, "#5c3e22"]])}
      </defs>
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("sky")} />
      {/* the low sun, its rays through the haze, and long clouds lit from below */}
      <circle cx={sun.x} cy={sun.y} r={220} fill={c.url("sun")} />
      {Array.from({ length: 9 }, (_, i) => {
        const a = Math.PI + 0.25 + i * 0.33;
        const ex = (d: number, da: number) => `${(sun.x + Math.cos(a + da) * d).toFixed(1)} ${(sun.y + Math.sin(a + da) * d).toFixed(1)}`;
        return <path key={i} d={`M ${sun.x} ${sun.y} L ${ex(900, -0.04)} L ${ex(900, 0.04)} Z`} fill="#fff4d2" opacity={0.08} />;
      })}
      <circle cx={sun.x} cy={sun.y} r={74} fill="#fff1c9" opacity={0.92} />
      {[
        [300, up(hz, 0.22), 230, 14],
        [980, up(hz, 0.34), 260, 12],
        [560, up(hz, 0.5), 180, 10],
      ].map(([x, y, w, h], i) => (
        <g key={i} {...c.motion("scn-drift", 40 + i * 9, -i * 7, { dx: 30 })}>
          <ellipse cx={x} cy={y} rx={w} ry={h} fill={c.url("cloud")} opacity={0.85} />
          <ellipse cx={x + 20} cy={y + h * 0.5} rx={w * 0.8} ry={h * 0.4} fill="#fff0c8" opacity={0.6} />
        </g>
      ))}
      <g transform={`translate(380 ${up(hz, 0.32)})`}>
        <g {...c.motion("scn-drift", 14, 0, { dx: 70 })}>
          {[
            [0, 0],
            [-30, 16],
            [30, 16],
            [-60, 32],
            [60, 32],
          ].map(([x, y], i) => (
            <path key={i} d={`M ${x - 12} ${y} L ${x} ${y + 8} L ${x + 12} ${y}`} fill="none" stroke={INK} strokeOpacity={0.7} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      </g>
      {/* two rows of trees on the horizon, the far one hazy */}
      {backLine.map((t, i) => (
        <circle key={`b${i}`} cx={t.x.toFixed(1)} cy={hz - 2} r={t.r.toFixed(1)} fill={t.fill} />
      ))}
      {haze(c, hz - 4, 50, "#fde3b3", 0.55)}
      {line.map((t, i) => (
        <g key={i}>
          <circle cx={t.x.toFixed(1)} cy={hz + 10} r={t.r.toFixed(1)} fill={t.fill} />
          <circle cx={(t.x - t.r * 0.25).toFixed(1)} cy={(hz + 10 - t.r * 0.3).toFixed(1)} r={(t.r * 0.5).toFixed(1)} fill="#ffd08a" opacity={0.25} />
        </g>
      ))}
      {hills(hz + 20, 24, 5, 0.8, c.h, c.url("hill"))}
      <rect x={0} y={hz + 60} width={SCENE_W} height={c.h - hz - 60} fill={c.url("field")} />
      {/* stubble rows running toward the low sun, warm light on the field, fallen leaves */}
      {Array.from({ length: 22 }, (_, i) => {
        const bx = -400 + i * 95;
        return <line key={i} x1={sun.x + (bx - sun.x) * 0.08} y1={hz + 62} x2={bx} y2={c.h} stroke="#6f4618" strokeOpacity={0.14} strokeWidth={2} />;
      })}
      <ellipse cx={sun.x} cy={hz + 90} rx={420} ry={60} fill={c.url("warm")} />
      {groundLeaves.map((l, i) => (
        <ellipse
          key={`gl${i}`}
          cx={l.x.toFixed(1)}
          cy={l.y.toFixed(1)}
          rx={(8 * l.s).toFixed(1)}
          ry={(4.5 * l.s).toFixed(1)}
          transform={`rotate(${l.a.toFixed(0)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`}
          fill={l.fill}
          opacity={0.9}
        />
      ))}
      {tufts(c, 7, 60, ["#8a5a24", "#a8743a", "#6f4618"])}
      {/* the rail fence behind the word: lit on the left, a shadow under each rail */}
      {posts.map((x) => (
        <g key={x}>
          <rect x={x} y={fy - 76} width={14} height={80} rx={3} fill="#6b4a2b" stroke={INK} strokeWidth={2.5} />
          <rect x={x + 2} y={fy - 74} width={4} height={76} fill="#a37748" opacity={0.6} />
          <ellipse cx={x + 16} cy={fy + 4} rx={18} ry={4} fill={INK} opacity={0.2} />
        </g>
      ))}
      {[fy - 62, fy - 32].map((y) => (
        <g key={y}>
          <rect x={-20} y={y + 10} width={SCENE_W + 40} height={5} fill={INK} opacity={0.18} />
          <rect x={-20} y={y} width={SCENE_W + 40} height={10} rx={4} fill={c.url("rail")} stroke={INK} strokeWidth={2.5} />
          <line x1={-20} y1={y + 3} x2={SCENE_W + 20} y2={y + 3} stroke="#c49563" strokeOpacity={0.6} strokeWidth={1.5} />
        </g>
      ))}
      {autumnTree(c, 120, c.G + 30, 1.1, 3, MAPLE)}
      {autumnTree(c, 1100, c.G - 20, 0.8, 8, BIRCH)}
      {leafPile(150, c.G + 70, 1.1, 4)}
      {leafPile(1080, c.G + 40, 0.8, 9)}
      {pumpkin(c, 990, c.G + 110, 1)}
      {pumpkin(c, 1110, c.G + 130, 0.8)}
    </g>
  );
};

export const fallFront: Layer = (c) => (
  <g>
    {fallers(c, 9, 18, {
      dur: [11, 17],
      swing: [30, 70],
      draw: (r) => leaf(AUTUMN[r.int(AUTUMN.length)]),
    })}
  </g>
);

