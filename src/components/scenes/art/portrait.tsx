/**
 * Picture Day: the school portrait backdrop, and nothing else (starl3xx, 2026-11-24: "picture day
 * can just be the cool backdrop"). Mottled studio blue, big soft clouds of light and shade with
 * small bright flecks among them and the faint creases of painted canvas, a soft key light behind
 * the word, the paper sweeping down into the floor, and the laser beams of a certain era, two fans
 * of them, slowly sweeping the opposite ways ("instead of the flash animation, the lasers in the
 * background should move").
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, lin, rad, scatter, vignette, type Ctx, type Layer } from "../kit";

/** One fan of laser beams from (vx, vy), each a soft glow with a bright core, sweeping as one. */
function laserFan(c: Ctx, seed: number, vx: number, vy: number, color: string, sweep: { dur: number; deg: number; delay: number }): ReactElement {
  const beams = scatter(seed, 6, (r, i) => {
    const a = (i / 6) * Math.PI * 2 + r.next() * 0.5;
    return { x2: (vx + Math.cos(a) * 1400).toFixed(1), y2: (vy + Math.sin(a) * 1400).toFixed(1) };
  });
  return (
    <g {...c.motion("scn-sweep", sweep.dur, sweep.delay, { ox: vx, oy: vy, deg: `${sweep.deg}deg` })}>
      {beams.map((b, i) => (
        <g key={i}>
          <line x1={vx} y1={vy} x2={b.x2} y2={b.y2} stroke={color} strokeOpacity={0.09} strokeWidth={18} />
          <line x1={vx} y1={vy} x2={b.x2} y2={b.y2} stroke={color} strokeOpacity={0.24} strokeWidth={3} />
        </g>
      ))}
    </g>
  );
}

export const portraitBack: Layer = (c) => {
  const blobs = scatter(21, 30, (r) => ({
    x: r.next() * SCENE_W,
    y: r.next() * c.G,
    rx: 80 + r.next() * 160,
    ry: 60 + r.next() * 120,
    kind: r.next() < 0.5 ? "lite" : r.next() < 0.75 ? "dark" : "tint",
  }));
  const flecks = scatter(44, 26, (r) => ({ x: r.next() * SCENE_W, y: r.next() * (c.G - 40), rx: 18 + r.next() * 40, ry: 12 + r.next() * 26 }));
  const creases = scatter(9, 9, (r) => ({ x: r.next() * SCENE_W, y: r.next() * (c.G - 120), len: 120 + r.next() * 220, bend: (r.next() - 0.5) * 60, tilt: (r.next() - 0.5) * 0.6 }));
  // The lasers fan out from a point behind the word.
  const vx = 600;
  const vy = c.G - 210;
  return (
    <g>
      <defs>
        {lin(c.id("drop"), [[0, "#93b6df"], [1, "#4a6c9f"]])}
        {rad(c.id("lite"), [[0, "#d9e8f8", 0.7], [1, "#d9e8f8", 0]])}
        {rad(c.id("dark"), [[0, "#2c4878", 0.5], [1, "#2c4878", 0]])}
        {rad(c.id("tint"), [[0, "#8c86d4", 0.32], [1, "#8c86d4", 0]])}
        {rad(c.id("fleck"), [[0, "#f2f7ff", 0.55], [1, "#f2f7ff", 0]])}
        {rad(c.id("key"), [[0, "#f4f8fd", 0.7], [0.6, "#dfeaf7", 0.25], [1, "#dfeaf7", 0]])}
        {rad(c.id("fill"), [[0, "#ffffff", 0.22], [1, "#ffffff", 0]])}
        {lin(c.id("sweep"), [[0, "#2a4572", 0], [1, "#1d3157", 0.65]])}
      </defs>
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("drop")} />
      {blobs.map((b, i) => (
        <ellipse key={i} cx={b.x.toFixed(1)} cy={b.y.toFixed(1)} rx={b.rx.toFixed(1)} ry={b.ry.toFixed(1)} fill={c.url(b.kind)} />
      ))}
      {flecks.map((f, i) => (
        <ellipse key={`f${i}`} cx={f.x.toFixed(1)} cy={f.y.toFixed(1)} rx={f.rx.toFixed(1)} ry={f.ry.toFixed(1)} fill={c.url("fleck")} />
      ))}
      {/* faint creases in the painted canvas */}
      {creases.map((k, i) => (
        <path
          key={`k${i}`}
          d={`M ${k.x.toFixed(1)} ${k.y.toFixed(1)} q ${(k.len / 2).toFixed(1)} ${(k.bend + k.len * k.tilt).toFixed(1)} ${k.len.toFixed(1)} ${(k.len * k.tilt).toFixed(1)}`}
          fill="none"
          stroke={i % 2 ? "#ffffff" : "#1c2f52"}
          strokeOpacity={0.07}
          strokeWidth={3}
        />
      ))}
      {laserFan(c, 8, vx, vy, "#ff7ad9", { dur: 9, deg: 11, delay: 0 })}
      {laserFan(c, 18, vx, vy, "#6ff3ff", { dur: 12, deg: -13, delay: -4 })}
      <ellipse cx={600} cy={c.G - 150} rx={460} ry={330} fill={c.url("key")} />
      <ellipse cx={260} cy={c.G - 300} rx={300} ry={220} fill={c.url("fill")} />
      {/* the backdrop paper curving down onto the floor */}
      <rect x={0} y={c.G - 70} width={SCENE_W} height={c.h - c.G + 70} fill={c.url("sweep")} />
      <path d={`M 0 ${c.G - 70} Q 600 ${c.G - 52} ${SCENE_W} ${c.G - 70}`} fill="none" stroke="#ffffff" strokeOpacity={0.12} strokeWidth={6} />
      <ellipse cx={600} cy={c.G + 8} rx={420} ry={34} fill={INK} opacity={0.16} />
    </g>
  );
};

export const portraitFront: Layer = (c) => <g>{vignette(c, 0.4, "#0f1c36")}</g>;
