/**
 * The Stage: a vaudeville house, and every player's first scene. Red velvet legs tied back with
 * gold rope, a swagged valance, a raked wooden stage in perspective, footlights along the apron,
 * and one warm spotlight on the word, with dust drifting in the beam.
 *
 * Materials carry the detail: the back drape is pleated velvet with a sheen on each crest, the
 * boards vary in tone and show their grain and joints, the floor has a polish that catches the
 * spot, the apron is paneled, and the footlights light the curtains from below.
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, lin, rad, scatter, tf, vignette, type Ctx, type Layer } from "../kit";

const VELVET = { dark: "#4a0f16", mid: "#7b1e26", light: "#a8323a", hi: "#c9474c", sheen: "#e5787a" };
export const GOLD = { dark: "#8a5a1c", mid: "#c8962b", light: "#f0c96a" };
const BOARD_TONES = ["#a87642", "#b5824b", "#9c6b3b", "#b98c55", "#a37243", "#ad7a46"];

function geom(c: Ctx) {
  return {
    back: c.G - 74, // where the boards meet the back drape
    front: c.G + 104, // the apron's front edge; its face runs to the bottom
  };
}

export const stageBack: Layer = (c) => {
  const { back, front } = geom(c);
  // Floorboards run upstage toward a vanishing point above the middle.
  const boards = 16;
  const bl = 170;
  const br = SCENE_W - 170;
  const fl = -110;
  const fr = SCENE_W + 110;
  const atBack = (t: number) => bl + t * (br - bl);
  const atFront = (t: number) => fl + t * (fr - fl);
  const xAt = (t: number, y: number) => {
    const k = (y - back) / (front - back);
    return atBack(t) + (atFront(t) - atBack(t)) * k;
  };
  const boardInfo = scatter(23, boards, (r) => ({ tone: BOARD_TONES[r.int(BOARD_TONES.length)], joint: 0.15 + r.next() * 0.7, knot: r.next() < 0.3 ? r.next() : -1 }));
  // Back-drape pleats, of slightly different widths.
  let px = -20;
  const pleats = scatter(5, 22, (r) => {
    const w = 58 + r.next() * 38;
    const p = { x: px, w, dark: r.next() < 0.5 };
    px += w;
    return p;
  }).filter((p) => p.x < SCENE_W + 20);
  const motes = scatter(11, 16, (r) => ({
    x: 470 + r.next() * 260,
    y: 60 + r.next() * (c.G - 120),
    r: 2 + r.next() * 3,
    d: 7 + r.next() * 7,
    delay: -r.next() * 12,
    dx: (r.next() - 0.5) * 40,
    dy: -20 - r.next() * 40,
  }));
  const lamps = 9;
  const depth = (t: number) => back + (front - back) * (t * t * 0.9 + t * 0.1);
  return (
    <g>
      <defs>
        {lin(c.id("wall"), [[0, "#0b1720"], [1, "#1f3a4d"]])}
        {lin(c.id("pleatA"), [[0, "#0d1d28"], [0.35, "#24465c"], [0.55, "#33607a"], [1, "#0d1d28"]], true)}
        {lin(c.id("pleatB"), [[0, "#0a1720"], [0.45, "#1d3b4f"], [1, "#0a1720"]], true)}
        {lin(c.id("drapeShade"), [[0, INK, 0.7], [0.4, INK, 0.05], [0.88, INK, 0], [1, INK, 0.55]])}
        {lin(c.id("drapeSides"), [[0, INK, 0.55], [0.28, INK, 0], [0.72, INK, 0], [1, INK, 0.55]], true)}
        {rad(c.id("glow"), [[0, "#ffd99a", 0.48], [0.6, "#ffb85c", 0.14], [1, "#ffb85c", 0]])}
        {rad(c.id("hot"), [[0, "#fff0c8", 0.4], [1, "#fff0c8", 0]])}
        {lin(c.id("floorShade"), [[0, INK, 0.58], [0.3, INK, 0.12], [0.7, INK, 0], [1, "#ffe3a8", 0.12]])}
        {rad(c.id("pool"), [[0, "#fff6dc", 0.8], [0.45, "#ffe4a6", 0.38], [1, "#ffe4a6", 0]])}
        {rad(c.id("sheen"), [[0, "#ffffff", 0.22], [1, "#ffffff", 0]])}
        {lin(c.id("beam"), [[0, "#fff4d6", 0.26], [1, "#fff4d6", 0.03]])}
        {lin(c.id("core"), [[0, "#fffaea", 0.3], [1, "#fffaea", 0.02]])}
        {lin(c.id("footGlow"), [[0, "#ffd27a", 0], [1, "#ffd27a", 0.32]])}
        {lin(c.id("apron"), [[0, "#6a4322"], [0.4, "#4f3119"], [1, "#24160b"]])}
        {rad(c.id("lampGlow"), [[0, "#ffe7a8", 0.85], [1, "#ffcf6b", 0]])}
        {lin(c.id("haze"), [[0, "#dfe9f2", 0.12], [1, "#dfe9f2", 0]])}
      </defs>

      {/* back drape: pleated blue velvet, a sheen on each crest, shadowed above and at the sides */}
      <rect x={0} y={0} width={SCENE_W} height={back} fill={c.url("wall")} />
      {pleats.map((p, i) => (
        <g key={i}>
          <rect x={p.x} y={0} width={p.w + 1} height={back} fill={c.url(p.dark ? "pleatB" : "pleatA")} />
          <line x1={p.x + p.w * 0.5} y1={0} x2={p.x + p.w * 0.52} y2={back} stroke="#7fb0cc" strokeOpacity={p.dark ? 0.1 : 0.2} strokeWidth={3} />
          <line x1={p.x} y1={0} x2={p.x} y2={back} stroke="#050d13" strokeOpacity={0.45} strokeWidth={3} />
        </g>
      ))}
      <rect x={0} y={0} width={SCENE_W} height={back} fill={c.url("drapeShade")} />
      <rect x={0} y={0} width={SCENE_W} height={back} fill={c.url("drapeSides")} />
      <ellipse cx={600} cy={back - 150} rx={470} ry={300} fill={c.url("glow")} />
      <ellipse cx={600} cy={back - 110} rx={210} ry={150} fill={c.url("hot")} />
      {/* the drape's hem gathers on the boards */}
      {pleats.map((p, i) => (
        <path key={`h${i}`} d={`M ${p.x} ${back} Q ${p.x + p.w / 2} ${back - 12} ${p.x + p.w} ${back}`} fill="none" stroke="#06111a" strokeOpacity={0.5} strokeWidth={2} />
      ))}

      {/* the stage floor, raked toward the house: boards of different tones, grain, joints, knots */}
      {boardInfo.map((b, i) => {
        const t0 = i / boards;
        const t1 = (i + 1) / boards;
        const jy = depth(b.joint);
        return (
          <g key={i}>
            <path d={`M ${atBack(t0)} ${back} L ${atBack(t1)} ${back} L ${atFront(t1)} ${front} L ${atFront(t0)} ${front} Z`} fill={b.tone} />
            {[0.3, 0.68].map((f) => {
              const t = t0 + (t1 - t0) * f;
              return (
                <path
                  key={f}
                  d={`M ${atBack(t)} ${back} Q ${(atBack(t) + atFront(t)) / 2 + (f - 0.5) * 18} ${(back + front) / 2} ${atFront(t)} ${front}`}
                  fill="none"
                  stroke="#5a3a1e"
                  strokeOpacity={0.16}
                  strokeWidth={1.6}
                />
              );
            })}
            <line x1={xAt(t0, jy)} y1={jy} x2={xAt(t1, jy)} y2={jy} stroke="#4a2c14" strokeOpacity={0.45} strokeWidth={2} />
            {b.knot >= 0 && (
              <ellipse cx={xAt(t0 + (t1 - t0) * 0.5, depth(b.knot))} cy={depth(b.knot)} rx={7 + b.knot * 6} ry={3 + b.knot * 2} fill="#5a3a1e" opacity={0.28} />
            )}
          </g>
        );
      })}
      {Array.from({ length: boards + 1 }, (_, i) => {
        const t = i / boards;
        return <line key={i} x1={atBack(t)} y1={back} x2={atFront(t)} y2={front} stroke="#3e2410" strokeOpacity={0.5} strokeWidth={2.5} />;
      })}
      <path d={`M ${bl} ${back} L ${br} ${back} L ${fr} ${front} L ${fl} ${front} Z`} fill={c.url("floorShade")} />
      <rect x={0} y={back - 3} width={SCENE_W} height={7} fill={INK} opacity={0.6} />
      {/* the polish catches the light, and the footlights warm the downstage boards */}
      <ellipse cx={600} cy={c.G + 34} rx={520} ry={26} fill={c.url("sheen")} />
      <rect x={0} y={front - 70} width={SCENE_W} height={70} fill={c.url("footGlow")} />

      {/* the spotlight: a beam through the haze with a brighter core, a pool at the word's feet */}
      <rect x={0} y={0} width={SCENE_W} height={back} fill={c.url("haze")} />
      <g {...c.motion("scn-breathe", 6, 0)}>
        <path d={`M 548 -20 L 652 -20 L 905 ${c.G + 8} L 295 ${c.G + 8} Z`} fill={c.url("beam")} />
        <path d={`M 578 -20 L 622 -20 L 760 ${c.G + 8} L 440 ${c.G + 8} Z`} fill={c.url("core")} />
        <ellipse cx={600} cy={c.G + 6} rx={340} ry={58} fill={c.url("pool")} />
      </g>
      {motes.map((m, i) => (
        <g key={i} transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`}>
          <circle r={m.r} fill="#fff8e6" opacity={0.55} {...c.motion("scn-mote", m.d, m.delay, { dx: m.dx, dy: m.dy })} />
        </g>
      ))}

      {/* the apron: a paneled face, a gold-lit lip, and the footlights */}
      <rect x={0} y={front} width={SCENE_W} height={Math.max(0, c.h - front)} fill={c.url("apron")} />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={i * 150 + 14} y={front + 18} width={122} height={Math.max(0, c.h - front - 30)} rx={4} fill="none" stroke="#7a512a" strokeOpacity={0.45} strokeWidth={2} />
      ))}
      <rect x={0} y={front - 2} width={SCENE_W} height={5} fill={INK} />
      <rect x={0} y={front + 3} width={SCENE_W} height={4} fill={GOLD.light} opacity={0.4} />
      <rect x={0} y={front + 7} width={SCENE_W} height={3} fill={INK} opacity={0.35} />
      {Array.from({ length: lamps }, (_, i) => {
        const x = 90 + (i * (SCENE_W - 180)) / (lamps - 1);
        return (
          <g key={i}>
            <ellipse cx={x} cy={front - 6} rx={70} ry={30} fill={c.url("lampGlow")} {...c.motion("scn-flicker", 3.2 + (i % 3) * 0.7, -i * 0.45)} />
            <path d={`M ${x - 24} ${front + 2} Q ${x} ${front - 24} ${x + 24} ${front + 2} Z`} fill="#3a2a1a" stroke={INK} strokeWidth={3} />
            <path d={`M ${x - 17} ${front + 1} Q ${x} ${front - 17} ${x + 17} ${front + 1} Z`} fill="#fff1c2" />
            <ellipse cx={x - 5} cy={front - 6} rx={5} ry={3} fill="#ffffff" opacity={0.8} />
          </g>
        );
      })}
    </g>
  );
};

/** One tied-back leg (the left one; the right is its mirror), in velvet folds that gather at the rope. */
function curtain(c: Ctx, side: "l" | "r"): ReactElement {
  const { front } = geom(c);
  const folds = 6;
  const topW = 265;
  const tieX = 112;
  const tieY = Math.round(c.G - 150);
  const botW = 225;
  const F = front + 4;
  const cyA = tieY * 0.58;
  const cyB = tieY + (F - tieY) * 0.42;
  const at = (k: number) => ({ t: -12 + (k * (topW + 12)) / folds, m: -12 + (k * (tieX + 12)) / folds, b: -12 + (k * (botW + 12)) / folds });
  const line = (p: { t: number; m: number; b: number }) => `M ${p.t} -8 Q ${p.t} ${cyA} ${p.m} ${tieY} Q ${p.m} ${cyB} ${p.b} ${F}`;
  const foldPath = (k: number) => {
    const a = at(k);
    const z = at(k + 1);
    return [
      `M ${a.t} -8 L ${z.t} -8`,
      `Q ${z.t} ${cyA} ${z.m} ${tieY}`,
      `Q ${z.m} ${cyB} ${z.b} ${F}`,
      `L ${a.b} ${F}`,
      `Q ${a.m} ${cyB} ${a.m} ${tieY}`,
      `Q ${a.t} ${cyA} ${a.t} -8 Z`,
    ].join(" ");
  };
  const mid = (k: number, f: number) => {
    const a = at(k);
    const z = at(k + 1);
    return { t: a.t + (z.t - a.t) * f, m: a.m + (z.m - a.m) * f, b: a.b + (z.b - a.b) * f };
  };
  const edge = line(at(folds));
  const rope = `M -14 ${tieY - 2} Q ${tieX / 2} ${tieY + 14} ${tieX + 16} ${tieY - 2}`;
  const outline = `M -12 -8 L ${at(folds).t} -8 Q ${at(folds).t} ${cyA} ${at(folds).m} ${tieY} Q ${at(folds).m} ${cyB} ${at(folds).b} ${F} L -12 ${F} Z`;
  return (
    <g {...tf(side === "r" ? `translate(${SCENE_W} 0) scale(-1 1)` : undefined)}>
      <g {...c.motion("scn-sway", 9, side === "r" ? -4.5 : 0)}>
        {/* a soft shadow the leg throws on the stage */}
        <ellipse cx={botW * 0.55} cy={F + 2} rx={botW * 0.7} ry={16} fill={INK} opacity={0.35} />
        {Array.from({ length: folds }, (_, k) => (
          <path key={k} d={foldPath(k)} fill={c.url(k % 2 ? "foldB" : "foldA")} stroke={VELVET.dark} strokeWidth={2} strokeOpacity={0.6} />
        ))}
        {/* the sheen along each fold's crest, and the shadow in each valley */}
        {Array.from({ length: folds }, (_, k) => (
          <g key={`c${k}`}>
            <path d={line(mid(k, 0.58))} fill="none" stroke={VELVET.sheen} strokeOpacity={k % 2 ? 0.16 : 0.3} strokeWidth={5} strokeLinecap="round" />
            <path d={line(mid(k, 0.08))} fill="none" stroke="#2a060b" strokeOpacity={0.35} strokeWidth={4} />
          </g>
        ))}
        {/* footlights warm the velvet from below; the gathered folds darken at the rope */}
        <path d={outline} fill={c.url("uplight")} />
        <ellipse cx={tieX / 2} cy={tieY + 6} rx={tieX * 0.9} ry={70} fill={c.url("gather")} />
        <path d={edge} fill="none" stroke={GOLD.mid} strokeWidth={7} />
        <path d={edge} fill="none" stroke={GOLD.light} strokeWidth={2} strokeOpacity={0.8} />
        {/* the gold rope tieback: a twisted cord across the gathered velvet, and its tassel */}
        <path d={rope} fill="none" stroke={INK} strokeWidth={17} strokeLinecap="round" />
        <path d={rope} fill="none" stroke={GOLD.mid} strokeWidth={11} strokeLinecap="round" />
        <path d={rope} fill="none" stroke={GOLD.light} strokeWidth={11} strokeDasharray="5 7" />
        <path d={`M ${tieX + 10} ${tieY + 4} Q ${tieX + 22} ${tieY + 28} ${tieX + 18} ${tieY + 46}`} fill="none" stroke={GOLD.dark} strokeWidth={4} />
        <circle cx={tieX + 18} cy={tieY + 50} r={9} fill={GOLD.mid} stroke={INK} strokeWidth={3} />
        <circle cx={tieX + 15} cy={tieY + 47} r={3} fill={GOLD.light} />
        <path
          d={`M ${tieX + 9} ${tieY + 56} L ${tieX + 27} ${tieY + 56} L ${tieX + 33} ${tieY + 98} Q ${tieX + 18} ${tieY + 106} ${tieX + 3} ${tieY + 98} Z`}
          fill={c.url("tassel")}
          stroke={INK}
          strokeWidth={3}
        />
        {[0, 6, 12, 18].map((dx) => (
          <line key={dx} x1={tieX + 9 + dx} y1={tieY + 60} x2={tieX + 7 + dx * 1.2} y2={tieY + 97} stroke={GOLD.dark} strokeWidth={2} />
        ))}
      </g>
    </g>
  );
}

/** The swagged valance across the top, with gold fringe and a tassel where each pair of swags meets. */
function valance(c: Ctx): ReactElement {
  const swags = 5;
  const w = SCENE_W / swags;
  const top = 16;
  const sag = 66;
  const lip = top + 10;
  return (
    <g>
      {/* the shadow the valance casts on the drape */}
      <rect x={0} y={lip} width={SCENE_W} height={sag * 2 + 30} fill={c.url("valShadow")} />
      {Array.from({ length: swags }, (_, i) => {
        const x0 = i * w - 26;
        const x1 = (i + 1) * w + 26;
        const xm = (x0 + x1) / 2;
        const curve = `M ${x0} ${lip} Q ${xm} ${lip + sag * 2} ${x1} ${lip}`;
        return (
          <g key={i}>
            <path d={`M ${x0} 0 L ${x1} 0 L ${x1} ${lip} Q ${xm} ${lip + sag * 2} ${x0} ${lip} Z`} fill={c.url("swag")} stroke={VELVET.dark} strokeWidth={2} />
            {[0.38, 0.7].map((f) => (
              <path key={f} d={`M ${x0 + 30} ${lip} Q ${xm} ${lip + sag * 2 * f} ${x1 - 30} ${lip}`} fill="none" stroke={VELVET.dark} strokeOpacity={0.55} strokeWidth={3} />
            ))}
            {/* sheen on the swag's lower roll */}
            <path d={`M ${x0 + 50} ${lip + 6} Q ${xm - 10} ${lip + sag * 1.72} ${x1 - 70} ${lip + 10}`} fill="none" stroke={VELVET.sheen} strokeOpacity={0.3} strokeWidth={6} strokeLinecap="round" />
            <path d={curve} fill="none" stroke={GOLD.dark} strokeWidth={15} strokeDasharray="3 3.5" transform="translate(0 2)" />
            <path d={curve} fill="none" stroke={GOLD.mid} strokeWidth={14} strokeDasharray="3 3.5" />
            <path d={curve} fill="none" stroke={GOLD.light} strokeWidth={4} transform="translate(0 -6)" />
          </g>
        );
      })}
      {/* the pelmet the swags hang from */}
      <rect x={0} y={0} width={SCENE_W} height={top + 8} fill={c.url("pelmet")} />
      <rect x={0} y={4} width={SCENE_W} height={3} fill="#fff4cf" opacity={0.6} />
      <rect x={0} y={top + 6} width={SCENE_W} height={4} fill={INK} opacity={0.6} />
      {Array.from({ length: swags - 1 }, (_, i) => {
        const x = (i + 1) * w;
        return (
          <g key={i}>
            <line x1={x} y1={top + 8} x2={x} y2={top + 40} stroke={GOLD.dark} strokeWidth={4} />
            <circle cx={x} cy={top + 44} r={8} fill={GOLD.mid} stroke={INK} strokeWidth={3} />
            <circle cx={x - 2.5} cy={top + 41} r={2.5} fill={GOLD.light} />
            <path d={`M ${x - 9} ${top + 50} L ${x + 9} ${top + 50} L ${x + 14} ${top + 86} Q ${x} ${top + 93} ${x - 14} ${top + 86} Z`} fill={c.url("tassel")} stroke={INK} strokeWidth={3} />
          </g>
        );
      })}
    </g>
  );
}

export const stageFront: Layer = (c) => (
  <g>
    <defs>
      {lin(c.id("foldA"), [[0, VELVET.dark], [0.45, VELVET.light], [0.7, VELVET.hi], [1, VELVET.dark]], true)}
      {lin(c.id("foldB"), [[0, VELVET.dark], [0.5, VELVET.mid], [1, VELVET.dark]], true)}
      {lin(c.id("swag"), [[0, VELVET.dark], [0.55, VELVET.mid], [1, VELVET.light]])}
      {lin(c.id("pelmet"), [[0, GOLD.light], [0.5, GOLD.mid], [1, GOLD.dark]])}
      {lin(c.id("tassel"), [[0, GOLD.light], [0.5, GOLD.mid], [1, GOLD.dark]], true)}
      {lin(c.id("uplight"), [[0, "#ffb85c", 0], [0.6, "#ffb85c", 0], [1, "#ffc46b", 0.3]])}
      {rad(c.id("gather"), [[0, "#1a0306", 0.45], [1, "#1a0306", 0]])}
      {lin(c.id("valShadow"), [[0, INK, 0.45], [1, INK, 0]])}
    </defs>
    {vignette(c, 0.35)}
    {curtain(c, "l")}
    {curtain(c, "r")}
    {valance(c)}
  </g>
);
