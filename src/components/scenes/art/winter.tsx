/**
 * Winter: a clear night in the mountains. The Milky Way, stars, a haloed full moon; two ranges of
 * snowy peaks, the far one pale with distance, each lit on its left by the moon and in shadow on
 * its right, with ragged snowfields; a cabin on the far hill spilling warm light; snow-laden pines
 * framing the sides; a snowman waving at the word's left; drifts, footprints, sparkle, and snow
 * falling.
 *
 * The peaks and pines are drawn from seeded shapes, not plain triangles: a ridge that wanders, a
 * spine that splits the lit face from the shadowed one, tiers of drooping, needle-edged branches
 * with snow resting on each.
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, fallers, hills, lin, rad, scatter, speckles, vignette, type Ctx, type Layer } from "../kit";
import { Rng } from "@/lib/rng";
import { haze, horizon, poly, up, type Pt } from "./outdoor";

type Tones = { lit: string; shade: string; snow: string; snowShade: string; rock: string };
const FAR: Tones = { lit: "#93a6d3", shade: "#7386b9", snow: "#e6edfb", snowShade: "#c3cfec", rock: "#5d6f9f" };
const NEAR: Tones = { lit: "#7086bd", shade: "#45558a", snow: "#f6f9ff", snowShade: "#b6c4e6", rock: "#34426f" };

/** Points up a slope from `a` to `b`, the ridge wandering a little (ends fixed). */
function slope(r: Rng, a: Pt, b: Pt, ts: number[], wander: number): Pt[] {
  return ts.map((t) => {
    const edge = t === 0 || t === 1 ? 0 : 1;
    return [a[0] + (b[0] - a[0]) * t + (r.next() - 0.5) * wander * edge, a[1] + (b[1] - a[1]) * t + (r.next() - 0.5) * wander * 0.7 * edge];
  });
}

/**
 * A peak: its left face lit by the moon, its right face in shadow, split along a crooked spine, and
 * a snowfield on each face down to a ragged line.
 */
function peak(seed: number, x: number, top: number, base: number, w: number, tones: Tones): ReactElement {
  const r = new Rng(seed);
  const ts = [0, 0.16, 0.32, 0.46, 0.58, 0.7, 0.8, 0.9, 1];
  const SNOW = 4; // index of the snowline in ts
  const summit: Pt = [x, top];
  const left = slope(r, [x - w, base], summit, ts, 30); // base → summit
  const right = slope(r, summit, [x + w * 0.95, base], ts, 30); // summit → base
  const spineBase: Pt = [x + w * 0.2, base];
  const spine = slope(r, summit, spineBase, ts, 22); // summit → base
  const ys = left[SNOW][1];
  // where each line crosses the snowline height
  const at = (line: Pt[], y: number): Pt => {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
        const k = (y - y0) / (y1 - y0);
        return [x0 + (x1 - x0) * k, y];
      }
    }
    return line[line.length - 1];
  };
  const teeth = (from: Pt, to: Pt): Pt[] =>
    Array.from({ length: 5 }, (_, j) => {
      const t = (j + 1) / 6;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + (j % 2 ? 10 + r.next() * 12 : -3 - r.next() * 5)];
    });
  const spineAbove = spine.filter((p) => p[1] <= ys);
  const sL = at(left, ys);
  const sS = at(spine, ys);
  const sR = at(right, ys);
  const litSnow: Pt[] = [...left.slice(SNOW).filter((p) => p[1] <= ys), summit, ...spineAbove.slice(1), sS, ...teeth(sS, sL), sL];
  const shadeSnow: Pt[] = [summit, ...right.filter((p) => p[1] < ys), sR, ...teeth(sR, sS), sS, ...spineAbove.slice(1).reverse()];
  // Short gullies running down and out from the spine below the snowline, on the lit face.
  const streaks = spine
    .filter((p) => p[1] > ys + 10 && p[1] < base - 20)
    .map((p, i) => {
      const len = 44 + r.next() * 30;
      return [p, [p[0] - len * 0.8, p[1] + len * (0.6 + i * 0.1)]] as const;
    });
  return (
    <g>
      <path d={poly([...left, ...spine.slice(1).reverse()])} fill={tones.lit} />
      <path d={poly([...spine, [x + w * 0.95, base], ...right.slice(0, -1).reverse()])} fill={tones.shade} />
      {streaks.map(([p, q], i) => (
        <path key={i} d={`M ${p[0].toFixed(1)} ${(p[1] + 8).toFixed(1)} Q ${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2 + 18).toFixed(1)} ${(q[0] - 10).toFixed(1)} ${(q[1] + 14).toFixed(1)}`} fill="none" stroke={tones.rock} strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      ))}
      <path d={poly(litSnow)} fill={tones.snow} />
      <path d={poly(shadeSnow)} fill={tones.snowShade} />
      <path d={poly(left.slice(SNOW - 1), false)} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={2.5} strokeLinejoin="round" />
    </g>
  );
}

/**
 * A pine: tiers of drooping branches with needle-edged hems, lit on the left, snow resting on each
 * tier and clumped on the lit tips. `far` draws a hazy silhouette with no detail.
 */
function pine(c: Ctx, seed: number, x: number, base: number, s: number, far = false): ReactElement {
  const r = new Rng(seed);
  const H = 330;
  const tiers = 5;
  const rows = Array.from({ length: tiers }, (_, i) => {
    const yb = -10 - (i / tiers) * H * 0.82;
    const yt = yb - H * 0.36;
    const w = 118 * (1 - (i / tiers) * 0.8) * (0.92 + r.next() * 0.16);
    return { yb, yt, w };
  });
  const hem = (w: number, yb: number) => {
    const n = 9;
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = k / n;
      const lift = Math.pow(Math.abs(t - 0.5) * 2, 2) * 10; // the tips lift a little
      return `L ${(-w + 2 * w * t).toFixed(1)} ${(yb - lift - (k % 2 ? 11 : 0)).toFixed(1)}`;
    }).join(" ");
  };
  const tier = (t: { yb: number; yt: number; w: number }) =>
    `M 0 ${t.yt.toFixed(1)} Q ${(-t.w * 0.42).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.55).toFixed(1)} ${(-t.w).toFixed(1)} ${(t.yb - 10).toFixed(1)} ${hem(t.w, t.yb)} Q ${(t.w * 0.42).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.55).toFixed(1)} 0 ${t.yt.toFixed(1)} Z`;
  if (far) {
    return (
      <g key={`fp${x}`} transform={`translate(${x} ${base}) scale(${s})`}>
        {rows.map((t, i) => (
          <path key={i} d={tier(t)} fill="#3e5a7c" />
        ))}
        {rows.map((t, i) => (
          <path key={`s${i}`} d={`M ${(-t.w * 0.5).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.5).toFixed(1)} Q 0 ${(t.yt - 4).toFixed(1)} ${(t.w * 0.3).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.4).toFixed(1)} Q 0 ${(t.yt + (t.yb - t.yt) * 0.3).toFixed(1)} ${(-t.w * 0.5).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.5).toFixed(1)} Z`} fill="#d9e3f7" opacity={0.85} />
        ))}
      </g>
    );
  }
  return (
    <g key={`p${x}`} transform={`translate(${x} ${base}) scale(${s})`}>
      <ellipse cx={30} cy={0} rx={120} ry={16} fill={c.url("treeShadow")} />
      <rect x={-10} y={-24} width={20} height={26} rx={3} fill="#4a3324" stroke={INK} strokeWidth={2.5} />
      {rows.map((t, i) => (
        <g key={i}>
          <path d={tier(t)} fill={c.url("needles")} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
          {/* snow on the tier's upper slope, deeper on the moonlit side, with a wavy edge */}
          <path
            d={`M ${(-t.w * 0.7).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.66).toFixed(1)} Q ${(-t.w * 0.3).toFixed(1)} ${(t.yt + 2).toFixed(1)} 0 ${(t.yt + 1).toFixed(1)} Q ${(t.w * 0.22).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.2).toFixed(1)} ${(t.w * 0.46).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.5).toFixed(1)} Q ${(t.w * 0.28).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.46).toFixed(1)} ${(t.w * 0.14).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.52).toFixed(1)} Q ${(-t.w * 0.08).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.4).toFixed(1)} ${(-t.w * 0.24).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.58).toFixed(1)} Q ${(-t.w * 0.46).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.5).toFixed(1)} ${(-t.w * 0.7).toFixed(1)} ${(t.yt + (t.yb - t.yt) * 0.66).toFixed(1)} Z`}
            fill={c.url("snowCap")}
          />
          <ellipse cx={(-t.w * 0.88).toFixed(1)} cy={(t.yb - 12).toFixed(1)} rx={(t.w * 0.16).toFixed(1)} ry={5} fill="#f4f8ff" />
          <ellipse cx={(-t.w * 0.45).toFixed(1)} cy={(t.yb - 8).toFixed(1)} rx={(t.w * 0.12).toFixed(1)} ry={4} fill="#eef3ff" />
        </g>
      ))}
      <path d={`M -6 ${(rows[tiers - 1].yt - 4).toFixed(1)} Q 0 ${(rows[tiers - 1].yt - 16).toFixed(1)} 6 ${(rows[tiers - 1].yt - 4).toFixed(1)} Z`} fill="#f4f8ff" />
    </g>
  );
}

/** The snowman at the word's left: a tilted head, a tipped top hat, a knitted scarf, one mitten waving. */
function snowman(c: Ctx, x: number, y: number): ReactElement {
  const ball = (cx: number, cy: number, rx: number, ry: number) => (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={c.url("ball")} stroke={INK} strokeWidth={3} />
      <path d={`M ${cx - rx * 0.82} ${cy + ry * 0.25} A ${rx} ${ry} 0 0 1 ${cx - rx * 0.1} ${cy - ry * 0.95}`} fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.9} />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={22} cy={4} rx={88} ry={14} fill={c.url("treeShadow")} />
      <path d="M -74 6 Q -60 -10 -20 -12 Q 30 -14 70 -2 Q 74 6 66 8 Z" fill="#eef3ff" />
      {/* the left arm raised and waving, in a red mitten; the right one down */}
      <g {...c.motion("scn-wave", 1.6, 0, { deg: "7deg" })}>
        <path d="M -34 -140 Q -66 -168 -90 -206" fill="none" stroke="#5a3a22" strokeWidth={6} strokeLinecap="round" />
        <path d="M -70 -176 L -86 -178 M -78 -190 L -74 -206" fill="none" stroke="#5a3a22" strokeWidth={4} strokeLinecap="round" />
        <path d="M -100 -214 Q -104 -230 -92 -232 Q -84 -230 -84 -220 L -80 -222 Q -76 -214 -84 -208 Q -94 -204 -100 -214 Z" fill="#d8463f" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
      <path d="M 38 -128 Q 58 -120 74 -108" fill="none" stroke="#5a3a22" strokeWidth={6} strokeLinecap="round" />
      <path d="M 60 -118 L 64 -132" fill="none" stroke="#5a3a22" strokeWidth={4} strokeLinecap="round" />
      {ball(0, -46, 56, 50)}
      {ball(3, -128, 41, 38)}
      {[-146, -128, -110].map((by, i) => (
        <ellipse key={by} cx={4 + i * 0.8} cy={by} rx={5.2} ry={4.6} fill="#22262f" transform={`rotate(${i * 25} ${4 + i * 0.8} ${by})`} />
      ))}
      {/* the head, tipped a little to one side */}
      <g transform="rotate(-7 -2 -192)">
        {ball(-2, -192, 31, 29)}
        <ellipse cx={-13} cy={-199} rx={4.4} ry={5} fill="#1b1714" />
        <ellipse cx={8} cy={-200} rx={4.4} ry={5} fill="#1b1714" />
        <circle cx={-14.5} cy={-201} r={1.4} fill="#ffffff" />
        <circle cx={6.5} cy={-202} r={1.4} fill="#ffffff" />
        <path d="M -2 -191 L 32 -186 L -2 -181 Z" fill={c.url("carrot")} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        {[8, 16, 24].map((dx) => (
          <line key={dx} x1={dx} y1={-188 + dx * 0.05} x2={dx - 2} y2={-184 + dx * 0.05} stroke="#a8501c" strokeWidth={1.5} />
        ))}
        {[-16, -10, -3, 4, 10].map((dx, i) => (
          <circle key={dx} cx={dx} cy={-176 + Math.abs(i - 2) * -1.6} r={2.4} fill="#1b1714" />
        ))}
        {/* the top hat, tipped back */}
        <g transform="rotate(-9 -2 -218)">
          <ellipse cx={-2} cy={-219} rx={34} ry={7} fill="#1b1714" />
          <path d="M -23 -220 L -21 -262 Q -2 -268 17 -262 L 19 -220 Z" fill={c.url("hat")} stroke={INK} strokeWidth={2} />
          <rect x={-22} y={-236} width={41} height={9} fill="#d8463f" />
          <rect x={-18} y={-260} width={5} height={36} rx={2.5} fill="#ffffff" opacity={0.18} />
        </g>
      </g>
      {/* the knitted scarf: a band around the neck, a knot, two striped tails with fringe */}
      <path d="M -32 -166 Q 2 -150 36 -166 L 37 -153 Q 2 -136 -33 -153 Z" fill="#d8463f" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      {[-18, -4, 10, 24].map((dx) => (
        <line key={dx} x1={dx} y1={-160 + Math.abs(dx - 3) * 0.15} x2={dx + 2} y2={-148 + Math.abs(dx - 3) * 0.15} stroke="#fbf4e3" strokeWidth={3} />
      ))}
      <path d="M 22 -156 Q 34 -136 30 -112 L 18 -112 Q 20 -134 12 -152 Z" fill="#d8463f" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M 30 -158 Q 46 -142 48 -120 L 37 -118 Q 34 -138 24 -152 Z" fill="#bd3d35" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <line x1={18} y1={-126} x2={31} y2={-126} stroke="#fbf4e3" strokeWidth={3} />
      <line x1={36} y1={-132} x2={47} y2={-134} stroke="#fbf4e3" strokeWidth={3} />
      {[19, 23, 27, 31].map((fx) => (
        <line key={fx} x1={fx} y1={-112} x2={fx - 1} y2={-104} stroke="#d8463f" strokeWidth={2.5} strokeLinecap="round" />
      ))}
      {[38, 42, 46].map((fx) => (
        <line key={fx} x1={fx} y1={-118} x2={fx} y2={-110} stroke="#bd3d35" strokeWidth={2.5} strokeLinecap="round" />
      ))}
      <ellipse cx={28} cy={-158} rx={9} ry={7} fill="#bd3d35" stroke={INK} strokeWidth={2.5} />
    </g>
  );
}

export const winterBack: Layer = (c) => {
  const hz = horizon(c);
  const moon = { x: 940, y: up(hz, 0.4) };
  const stars = scatter(17, 46, (r) => ({ x: r.next() * SCENE_W, y: r.next() * (hz - 40), r: 1.4 + r.next() * 2.6, d: 1.2 + r.next() * 2.4, delay: -r.next() * 3, tw: r.next() < 0.5 }));
  const bright = scatter(27, 6, (r) => ({ x: 80 + r.next() * 1040, y: 30 + r.next() * (hz - 120), d: -r.next() * 3 }));
  const glints = scatter(37, 22, (r) => {
    const t = r.next();
    return { x: r.next() * SCENE_W, y: c.G - 60 + t * (c.h - c.G + 50), s: 0.5 + t * 0.7, d: -r.next() * 4 };
  });
  const prints = Array.from({ length: 8 }, (_, i) => ({ x: 214 + i * 32, y: c.G + 96 - i * 13 }));
  const cabin = { x: 960, y: hz + 18 };
  const farPeaks = [
    [60, 0.55, 150],
    [280, 0.68, 170],
    [640, 0.6, 160],
    [880, 0.72, 150],
    [1150, 0.62, 170],
  ];
  const nearPeaks = [
    [120, 0.56, 230],
    [470, 0.42, 270],
    [820, 0.6, 220],
    [1130, 0.5, 240],
  ];
  return (
    <g>
      <defs>
        {lin(c.id("sky"), [[0, "#081129"], [0.6, "#1f3163"], [1, "#3b5590"]])}
        {rad(c.id("milky"), [[0, "#c9d6ff", 0.16], [1, "#c9d6ff", 0]])}
        {rad(c.id("moon"), [[0, "#fdf8dc", 0.55], [1, "#fdf8dc", 0]])}
        {rad(c.id("moonDisk"), [[0, "#fffbe8"], [0.7, "#ece6c4"], [1, "#cfc79f"]])}
        {rad(c.id("window"), [[0, "#ffd27a", 0.75], [1, "#ffd27a", 0]])}
        {rad(c.id("spill"), [[0, "#ffd58a", 0.45], [1, "#ffd58a", 0]])}
        {lin(c.id("far"), [[0, "#d6e0f4"], [1, "#b3c3e4"]])}
        {lin(c.id("near"), [[0, "#e8effb"], [1, "#c9d7f0"]])}
        {lin(c.id("snow"), [[0, "#eef4ff"], [0.6, "#dfe8f8"], [1, "#c8d6ef"]])}
        {rad(c.id("ball"), [[0, "#ffffff"], [0.55, "#f1f5fd"], [1, "#b4c4e4"]])}
        {lin(c.id("needles"), [[0, "#2f6f53"], [0.45, "#1f5240"], [1, "#0e3125"]], true)}
        {lin(c.id("snowCap"), [[0, "#ffffff"], [0.6, "#eef3ff"], [1, "#bfcdea"]], true)}
        {rad(c.id("treeShadow"), [[0, "#5b70a6", 0.45], [1, "#5b70a6", 0]])}
        {lin(c.id("carrot"), [[0, "#ffb070"], [1, "#e0692a"]])}
        {lin(c.id("hat"), [[0, "#3a3f4a"], [0.4, "#1b1d24"], [1, "#101216"]], true)}
      </defs>
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("sky")} />
      {/* the Milky Way: a soft band across the sky, thick with faint stars */}
      <g transform={`rotate(-18 600 ${up(hz, 0.45)})`}>
        <ellipse cx={600} cy={up(hz, 0.45)} rx={760} ry={70} fill={c.url("milky")} />
        {speckles(29, 90, [-100, up(hz, 0.45) - 50, 1300, up(hz, 0.45) + 50], ["#ffffff", "#dfe6ff"], [0.6, 1.4], 0.7)}
      </g>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(1)} fill="#fff8e1" {...(s.tw ? c.motion("scn-twinkle", s.d, s.delay) : {})} />
      ))}
      {bright.map((s, i) => (
        <g key={`br${i}`} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}>
          <path d="M 0 -10 Q 1 -1 10 0 Q 1 1 0 10 Q -1 1 -10 0 Q -1 -1 0 -10 Z" fill="#ffffff" {...c.motion("scn-twinkle", 2.4, s.d)} />
        </g>
      ))}
      {/* the moon: a halo, a glow, a shaded disk with craters */}
      <circle cx={moon.x} cy={moon.y} r={150} fill={c.url("moon")} />
      <circle cx={moon.x} cy={moon.y} r={92} fill="none" stroke="#fdf8dc" strokeOpacity={0.12} strokeWidth={10} />
      <circle cx={moon.x} cy={moon.y} r={54} fill={c.url("moonDisk")} stroke="#d9d2ac" strokeWidth={3} />
      {[
        [-18, -12, 10],
        [18, 14, 14],
        [12, -20, 6],
        [-10, 20, 7],
      ].map(([dx, dy, r], i) => (
        <g key={i}>
          <circle cx={moon.x + dx} cy={moon.y + dy} r={r} fill="#ddd6b2" />
          <path d={`M ${moon.x + dx - r * 0.8} ${moon.y + dy - r * 0.3} A ${r} ${r} 0 0 1 ${moon.x + dx + r * 0.4} ${moon.y + dy - r * 0.9}`} fill="none" stroke="#c8c09a" strokeWidth={2} />
        </g>
      ))}

      {/* two ranges of peaks, the far one pale with distance, then haze where they meet the hills */}
      {farPeaks.map(([x, k, w], i) => (
        <g key={i}>{peak(100 + i, x, hz - 40 - (hz - 40) * k * 0.5, hz + 30, w, FAR)}</g>
      ))}
      {haze(c, hz - 10, 90, "#7f93c6", 0.55)}
      {nearPeaks.map(([x, k, w], i) => (
        <g key={i}>{peak(200 + i, x, hz + 30 - (hz - 20) * (1 - k) * 0.62 - 60, hz + 40, w, NEAR)}</g>
      ))}
      {haze(c, hz + 34, 60, "#a8b9de", 0.65)}
      {hills(hz + 36, 26, 4, 0.4, c.h, c.url("far"))}
      {pine(c, 3, 360, hz + 70, 0.2, true)}
      {pine(c, 4, 400, hz + 74, 0.16, true)}
      {pine(c, 5, 736, hz + 66, 0.18, true)}
      {pine(c, 6, 1050, hz + 62, 0.17, true)}
      {/* a cabin on the far hill: a lit window spilling light on the snow, smoke from the chimney */}
      <g transform={`translate(${cabin.x} ${cabin.y})`}>
        <ellipse cx={0} cy={14} rx={120} ry={22} fill={c.url("spill")} />
        <circle cx={0} cy={-26} r={70} fill={c.url("window")} />
        <rect x={20} y={-86} width={16} height={34} fill="#5a3a22" stroke={INK} strokeWidth={2.5} />
        <rect x={-46} y={-44} width={92} height={50} fill="#7a4a2a" stroke={INK} strokeWidth={2.5} />
        {[-34, -24, -14, -4].map((ly) => (
          <line key={ly} x1={-44} y1={ly} x2={44} y2={ly} stroke={INK} strokeOpacity={0.3} strokeWidth={1.5} />
        ))}
        <rect x={10} y={-42} width={34} height={46} fill="#3d2414" opacity={0.35} />
        <path d="M -62 -40 L 0 -88 L 62 -40 Q 30 -34 0 -38 Q -30 -34 -62 -40 Z" fill="#eef3ff" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        <path d="M 0 -88 L 62 -40 Q 40 -36 26 -38 Z" fill="#bccbe6" />
        <rect x={-14} y={-30} width={28} height={22} fill="#ffd27a" stroke={INK} strokeWidth={2.5} />
        <line x1={0} y1={-30} x2={0} y2={-8} stroke={INK} strokeWidth={2} />
        <line x1={-14} y1={-19} x2={14} y2={-19} stroke={INK} strokeWidth={2} />
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(28 ${-96 - i * 22})`}>
            <circle r={9 + i * 4} fill="#dfe6f5" opacity={0.6 - i * 0.15} {...c.motion("scn-mote", 6, -i * 2, { dx: 30, dy: -50 })} />
          </g>
        ))}
      </g>
      {hills(hz + 74, 22, 5, 2.1, c.h, c.url("near"))}
      <rect x={0} y={c.G - 70} width={SCENE_W} height={c.h - c.G + 70} fill={c.url("snow")} />
      {/* drifts: soft blue hollows and bright crests */}
      {[c.G - 40, c.G + 30, c.G + 100].map((dy, i) => (
        <g key={i}>
          <path d={`M -20 ${dy + 10} Q 200 ${dy - 14} 420 ${dy + 6} T 860 ${dy + 2} T 1240 ${dy - 4}`} fill="none" stroke="#a9bbe0" strokeOpacity={0.45} strokeWidth={6} />
          <path d={`M -20 ${dy + 4} Q 200 ${dy - 20} 420 ${dy} T 860 ${dy - 4} T 1240 ${dy - 10}`} fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={3} />
        </g>
      ))}
      {/* footprints from the snowman back toward the hills */}
      {prints.map((p, i) => (
        <ellipse key={`fp${i}`} cx={p.x + (i % 2) * 12} cy={p.y} rx={6 - i * 0.4} ry={3.6 - i * 0.2} fill="#9fb2d9" opacity={0.6} />
      ))}
      {glints.map((g, i) => (
        <g key={`gl${i}`} transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) scale(${g.s.toFixed(2)})`}>
          <path d="M 0 -6 Q 0.6 -0.6 6 0 Q 0.6 0.6 0 6 Q -0.6 0.6 -6 0 Q -0.6 -0.6 0 -6 Z" fill="#ffffff" {...c.motion("scn-twinkle", 2.2, g.d)} />
        </g>
      ))}
      {pine(c, 11, 250, c.G - 46, 0.52)}
      {pine(c, 12, 1196, c.G + 74, 0.92)}
      {pine(c, 13, 1086, c.G + 28, 0.74)}
      {snowman(c, 112, c.G + 72)}
    </g>
  );
};

export const winterFront: Layer = (c) => (
  <g>
    {vignette(c, 0.25, "#0b1631")}
    {fallers(c, 3, 46, {
      dur: [9, 17],
      swing: [8, 26],
      draw: (r) => <circle r={(2 + r.next() * 4.5).toFixed(1)} fill="#ffffff" opacity={0.92} />,
    })}
  </g>
);
