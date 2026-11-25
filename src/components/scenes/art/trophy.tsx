/**
 * The Trophy Case: the word on display. A glass-fronted cabinet with a tufted green velvet back,
 * the word standing on a fringed red runner on a polished shelf with a brass plaque, trophies on
 * glass shelves above (two shelves when the picture is tall, one on a wide card), warm downlights,
 * sparkles, and now and then a gleam crossing the glass.
 *
 * Materials carry the detail: the velvet is buttoned and puffed between the buttons, the wood shows
 * its grain, the gold catches a highlight down one side, and each trophy throws a soft shadow on
 * the velvet behind it.
 */
import type { ReactElement } from "react";
import { INK, SCENE_W, lin, rad, scatter, vignette, type Ctx, type Layer } from "../kit";
import { GOLD } from "./stage";

const WOOD = { dark: "#3a1c10", mid: "#5e2f18", light: "#8a4a26" };
const FRAME_X = 54;
const RAIL = 44;
const Q = 96; // the velvet's button spacing

function geom(c: Ctx) {
  const shelfBack = c.G - 56;
  const shelfFront = c.G + 52;
  const upper = c.G - 330;
  // A second shelf of trophies when there is room above the first (a tall picture).
  const top = upper - RAIL > 230 ? upper - 170 : null;
  return { shelfBack, shelfFront, upper, top };
}

/** A soft shadow a trophy throws on the velvet behind it, up and to the right of its base. */
function backShadow(c: Ctx, x: number, y: number, s: number): ReactElement {
  return <ellipse key={`sh${x}-${y}`} cx={x + 16 * s} cy={y - 48 * s} rx={44 * s} ry={58 * s} fill={c.url("shadow")} />;
}

/** A gold cup on a plinth, base at (x, y), `s` times life size. */
function cup(c: Ctx, x: number, y: number, s: number): ReactElement {
  const handle = "M -32 -92 C -62 -92 -60 -58 -24 -58";
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-34} y={-18} width={68} height={18} rx={3} fill={c.url("plinth")} stroke={INK} strokeWidth={3} />
      <rect x={-28} y={-12} width={56} height={5} rx={1} fill={GOLD.mid} opacity={0.8} />
      <rect x={-24} y={-30} width={48} height={13} rx={2} fill={c.url("metal")} stroke={INK} strokeWidth={3} />
      <rect x={-6} y={-54} width={12} height={25} fill={c.url("metal")} stroke={INK} strokeWidth={3} />
      <path d={handle} fill="none" stroke={INK} strokeWidth={11} />
      <path d={handle} fill="none" stroke={GOLD.mid} strokeWidth={5} />
      <path d={handle} transform="scale(-1 1)" fill="none" stroke={INK} strokeWidth={11} />
      <path d={handle} transform="scale(-1 1)" fill="none" stroke={GOLD.dark} strokeWidth={5} />
      <path d="M -36 -104 L 36 -104 Q 36 -56 0 -52 Q -36 -56 -36 -104 Z" fill={c.url("metal")} stroke={INK} strokeWidth={3} />
      {/* a highlight down the left of the bowl, a shadow down the right */}
      <path d="M -24 -98 Q -24 -70 -8 -60" fill="none" stroke="#fffbe8" strokeOpacity={0.75} strokeWidth={5} strokeLinecap="round" />
      <path d="M 28 -100 Q 28 -66 6 -56" fill="none" stroke={GOLD.dark} strokeOpacity={0.6} strokeWidth={5} strokeLinecap="round" />
      <ellipse cx={0} cy={-104} rx={36} ry={6} fill={GOLD.light} stroke={INK} strokeWidth={3} />
      <ellipse cx={0} cy={-103} rx={28} ry={3} fill={GOLD.dark} opacity={0.5} />
      <path d="M 0 -92 L 4 -82 L 14 -81 L 6 -74 L 9 -64 L 0 -70 L -9 -64 L -6 -74 L -14 -81 L -4 -82 Z" fill={GOLD.dark} opacity={0.7} />
    </g>
  );
}

/** A star on a column. */
function starTrophy(c: Ctx, x: number, y: number, s: number): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-30} y={-16} width={60} height={16} rx={3} fill={c.url("plinth")} stroke={INK} strokeWidth={3} />
      <rect x={-9} y={-62} width={18} height={47} fill={c.url("metal")} stroke={INK} strokeWidth={3} />
      <line x1={-4} y1={-58} x2={-4} y2={-20} stroke="#fffbe8" strokeOpacity={0.7} strokeWidth={3} />
      <path d="M 0 -120 L 11 -96 L 37 -94 L 17 -77 L 24 -52 L 0 -66 L -24 -52 L -17 -77 L -37 -94 L -11 -96 Z" fill={c.url("metal")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 0 -112 L 7 -96 L 0 -86 L -7 -96 Z" fill="#fffbe8" opacity={0.6} />
    </g>
  );
}

/** A prize rosette on a little easel. */
function rosette(x: number, y: number, s: number, color: string, dark: string): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M -26 0 L -6 -40 M 26 0 L 6 -40" stroke={WOOD.mid} strokeWidth={6} strokeLinecap="round" />
      <path d="M -10 -46 L -22 -4 L -12 -10 L -6 0 L 2 -40 Z" fill={color} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 10 -46 L 22 -4 L 12 -10 L 6 0 L -2 -40 Z" fill={dark} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <circle cx={0} cy={-70} r={32} fill={color} stroke={INK} strokeWidth={3} />
      <circle cx={0} cy={-70} r={29} fill="none" stroke={dark} strokeWidth={6} strokeDasharray="3 4" />
      <circle cx={0} cy={-70} r={22} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="2 3" />
      <circle cx={0} cy={-70} r={15} fill={GOLD.light} stroke={INK} strokeWidth={3} />
      <circle cx={-5} cy={-75} r={5} fill="#fffbe8" opacity={0.7} />
    </g>
  );
}

/** A wooden shield plaque with a brass plate. */
function plaque(c: Ctx, x: number, y: number, s: number): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M -38 -104 L 38 -104 L 38 -40 Q 38 -10 0 0 Q -38 -10 -38 -40 Z" fill={c.url("plinth")} stroke={INK} strokeWidth={3} />
      <path d="M -30 -96 L -30 -42 Q -30 -18 0 -9" fill="none" stroke={WOOD.light} strokeOpacity={0.6} strokeWidth={3} />
      <path d="M -24 -90 L 24 -90 L 24 -46 Q 24 -26 0 -18 Q -24 -26 -24 -46 Z" fill={c.url("metal")} stroke={INK} strokeWidth={2.5} />
      <line x1={-12} y1={-70} x2={12} y2={-70} stroke={GOLD.dark} strokeWidth={3} />
      <line x1={-8} y1={-58} x2={8} y2={-58} stroke={GOLD.dark} strokeWidth={3} />
    </g>
  );
}

function sparkle(c: Ctx, x: number, y: number, s: number, delay: number): ReactElement {
  return (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M 0 -14 Q 2 -2 14 0 Q 2 2 0 14 Q -2 2 -14 0 Q -2 -2 0 -14 Z" fill="#fffbe8" {...c.motion("scn-twinkle", 1.6, delay)} />
    </g>
  );
}

/** A glass shelf at y: its top seen from a little above, a bright front edge, a shadow below. */
function glassShelf(c: Ctx, y: number): ReactElement {
  return (
    <g>
      <rect x={FRAME_X} y={y + 8} width={SCENE_W - 2 * FRAME_X} height={30} fill={c.url("underShelf")} />
      <path d={`M 110 ${y - 12} L ${SCENE_W - 110} ${y - 12} L ${SCENE_W - FRAME_X} ${y} L ${FRAME_X} ${y} Z`} fill="#d9f4f2" opacity={0.3} />
      <rect x={FRAME_X} y={y} width={SCENE_W - 2 * FRAME_X} height={8} fill="#a9ddd9" opacity={0.85} />
      <rect x={FRAME_X} y={y} width={SCENE_W - 2 * FRAME_X} height={2} fill="#ffffff" opacity={0.9} />
      <rect x={FRAME_X} y={y + 6} width={SCENE_W - 2 * FRAME_X} height={2} fill="#3c7a74" opacity={0.6} />
    </g>
  );
}

/** Wood grain: long, slightly wavy lines, as a tile that repeats along a board. */
function grainPattern(id: string, across: boolean): ReactElement {
  const lines = [6, 15, 23, 31];
  const L = 220;
  return (
    <pattern id={id} width={across ? L : 38} height={across ? 38 : L} patternUnits="userSpaceOnUse">
      {lines.map((o, i) => (
        <path
          key={i}
          d={across ? `M 0 ${o} Q ${L * 0.3} ${o + 3} ${L * 0.55} ${o} T ${L} ${o}` : `M ${o} 0 Q ${o + 3} ${L * 0.3} ${o} ${L * 0.55} T ${o} ${L}`}
          fill="none"
          stroke="#1f0d05"
          strokeOpacity={i % 2 ? 0.18 : 0.28}
          strokeWidth={i % 2 ? 1.2 : 2}
        />
      ))}
    </pattern>
  );
}

export const trophyBack: Layer = (c) => {
  const { shelfBack, shelfFront, upper, top } = geom(c);
  const lamps = [250, 600, 950];
  const face = shelfFront + 40;
  return (
    <g>
      <defs>
        {lin(c.id("velvet"), [[0, "#0d2925"], [1, "#1f4f44"]])}
        {lin(c.id("side"), [[0, "#08191a"], [1, "#123631"]])}
        {lin(c.id("beam"), [[0, "#fff1c9", 0.28], [1, "#fff1c9", 0]])}
        {rad(c.id("glow"), [[0, "#ffe1a0", 0.42], [1, "#ffe1a0", 0]])}
        {rad(c.id("pool"), [[0, "#ffe7b0", 0.42], [1, "#ffe7b0", 0]])}
        {rad(c.id("pillow"), [[0, "#5fa592", 0.28], [1, "#5fa592", 0]])}
        {rad(c.id("dimple"), [[0, "#03100e", 0.6], [1, "#03100e", 0]])}
        {rad(c.id("shadow"), [[0, "#03100e", 0.45], [1, "#03100e", 0]])}
        {lin(c.id("metal"), [[0, GOLD.dark], [0.3, GOLD.light], [0.5, "#fff3c4"], [0.72, GOLD.mid], [1, GOLD.dark]], true)}
        {lin(c.id("plinth"), [[0, "#24100a"], [0.4, WOOD.mid], [1, "#24100a"]], true)}
        {lin(c.id("underShelf"), [[0, INK, 0.32], [1, INK, 0]])}
        {lin(c.id("shelf"), [[0, "#3d1d0f"], [1, "#82421f"]])}
        {lin(c.id("runner"), [[0, "#4d0f17"], [0.45, "#9b2a32"], [0.6, "#b23a40"], [1, "#6a1520"]])}
        {lin(c.id("face"), [[0, WOOD.mid], [1, WOOD.dark]])}
        {grainPattern(c.id("grainH"), true)}
        <pattern id={c.id("quilt")} width={Q} height={Q} patternUnits="userSpaceOnUse">
          {/* the puffed velvet between buttons, then the stitched seams, then the buttons */}
          {[
            [Q / 2, 0],
            [0, Q / 2],
            [Q, Q / 2],
            [Q / 2, Q],
          ].map(([x, y], i) => (
            <ellipse key={`p${i}`} cx={x} cy={y} rx={Q * 0.36} ry={Q * 0.36} fill={c.url("pillow")} />
          ))}
          <path d={`M 0 0 L ${Q} ${Q} M ${Q} 0 L 0 ${Q}`} stroke="#03100e" strokeOpacity={0.4} strokeWidth={2} />
          {[
            [0, 0],
            [Q, 0],
            [0, Q],
            [Q, Q],
            [Q / 2, Q / 2],
          ].map(([x, y], i) => (
            <g key={`b${i}`}>
              <circle cx={x} cy={y} r={15} fill={c.url("dimple")} />
              <circle cx={x} cy={y} r={4} fill="#06201c" />
              <circle cx={x - 1.2} cy={y - 1.2} r={1.5} fill="#7cc0ad" opacity={0.7} />
            </g>
          ))}
        </pattern>
      </defs>

      {/* the tufted velvet back, and the cabinet's inner walls in perspective */}
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("velvet")} />
      <rect x={0} y={0} width={SCENE_W} height={c.h} fill={c.url("quilt")} />
      <path d={`M 0 0 L 110 ${RAIL + 36} L 110 ${shelfBack} L 0 ${shelfFront} Z`} fill={c.url("side")} />
      <path d={`M ${SCENE_W} 0 L ${SCENE_W - 110} ${RAIL + 36} L ${SCENE_W - 110} ${shelfBack} L ${SCENE_W} ${shelfFront} Z`} fill={c.url("side")} />
      <path d={`M 0 0 L ${SCENE_W} 0 L ${SCENE_W - 110} ${RAIL + 36} L 110 ${RAIL + 36} Z`} fill="#061513" />

      {/* downlights, their beams, and warm pools on the velvet */}
      {lamps.map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={upper - 70} rx={190} ry={150} fill={c.url("glow")} />
          <path d={`M ${x - 16} ${RAIL + 30} L ${x + 16} ${RAIL + 30} L ${x + 150} ${shelfBack} L ${x - 150} ${shelfBack} Z`} fill={c.url("beam")} {...c.motion("scn-breathe", 5 + x / 300, -x / 200)} />
          <ellipse cx={x} cy={RAIL + 31} rx={22} ry={7} fill="#fff6dd" stroke={INK} strokeWidth={2} />
        </g>
      ))}

      {/* the shelves of trophies, each throwing a soft shadow on the velvet */}
      {top !== null && (
        <g>
          {glassShelf(c, top)}
          {[250, 400, 800, 950].map((x) => backShadow(c, x, top, 0.8))}
          {plaque(c, 250, top, 0.8)}
          {rosette(400, top, 0.85, "#2a9d8f", "#1a5e56")}
          {cup(c, 800, top, 0.7)}
          {rosette(950, top, 0.85, "#d8463f", "#9a2f29")}
        </g>
      )}
      {glassShelf(c, upper)}
      {[
        [230, 0.85],
        [400, 0.85],
        [600, 1],
        [800, 0.85],
        [970, 0.75],
      ].map(([x, s]) => backShadow(c, x, upper, s))}
      {cup(c, 230, upper, 0.85)}
      {starTrophy(c, 400, upper, 0.85)}
      {cup(c, 600, upper, 1)}
      {plaque(c, 800, upper, 0.85)}
      {cup(c, 970, upper, 0.75)}
      {[
        [262, upper - 92, 0.9, 0],
        [620, upper - 108, 1.1, -0.6],
        [420, upper - 110, 0.7, -1.1],
        [985, upper - 70, 0.8, -0.3],
      ].map(([x, y, s, d]) => sparkle(c, x, y, s, d))}

      {/* the display shelf: grained, polished wood, a fringed velvet runner, a brass plaque */}
      <path d={`M 110 ${shelfBack} L ${SCENE_W - 110} ${shelfBack} L ${SCENE_W} ${shelfFront} L 0 ${shelfFront} Z`} fill={c.url("shelf")} />
      <path d={`M 110 ${shelfBack} L ${SCENE_W - 110} ${shelfBack} L ${SCENE_W} ${shelfFront} L 0 ${shelfFront} Z`} fill={c.url("grainH")} />
      <path d={`M 90 ${c.G - 26} L ${SCENE_W - 90} ${c.G - 26} L ${SCENE_W - 40} ${c.G + 34} L 40 ${c.G + 34} Z`} fill={c.url("runner")} />
      <path d={`M 90 ${c.G - 26} L ${SCENE_W - 90} ${c.G - 26}`} stroke={GOLD.mid} strokeWidth={3} />
      <path d={`M 40 ${c.G + 34} L ${SCENE_W - 40} ${c.G + 34}`} stroke={GOLD.mid} strokeWidth={5} />
      <path d={`M 40 ${c.G + 40} L ${SCENE_W - 40} ${c.G + 40}`} stroke={GOLD.dark} strokeWidth={9} strokeDasharray="2.5 3" />
      {lamps.map((x) => (
        <ellipse key={x} cx={x} cy={c.G + 4} rx={170} ry={28} fill={c.url("pool")} />
      ))}
      <rect x={0} y={shelfFront} width={SCENE_W} height={face - shelfFront} fill={c.url("face")} />
      <rect x={0} y={shelfFront} width={SCENE_W} height={face - shelfFront} fill={c.url("grainH")} />
      <rect x={0} y={shelfFront} width={SCENE_W} height={4} fill={GOLD.light} opacity={0.6} />
      <rect x={470} y={shelfFront + 9} width={260} height={22} rx={4} fill={c.url("metal")} stroke={INK} strokeWidth={2.5} />
      <line x1={520} y1={shelfFront + 20} x2={680} y2={shelfFront + 20} stroke={GOLD.dark} strokeWidth={3} />
      {[478, 722].map((x) => (
        <circle key={x} cx={x} cy={shelfFront + 20} r={2.5} fill={GOLD.dark} />
      ))}
      {/* the cabinet's base below: raised panels and brass knobs */}
      <rect x={0} y={face} width={SCENE_W} height={Math.max(0, c.h - face)} fill={WOOD.dark} />
      <rect x={0} y={face} width={SCENE_W} height={Math.max(0, c.h - face)} fill={c.url("grainH")} />
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={90 + i * 530} y={face + 14} width={490} height={Math.max(0, c.h - face - 28)} rx={6} fill="none" stroke={WOOD.light} strokeOpacity={0.6} strokeWidth={3} />
          <rect x={93 + i * 530} y={face + 17} width={484} height={Math.max(0, c.h - face - 34)} rx={5} fill="none" stroke="#120703" strokeOpacity={0.5} strokeWidth={2} />
          <circle cx={335 + i * 530} cy={face + (c.h - face) / 2} r={7} fill={GOLD.mid} stroke={INK} strokeWidth={2} />
          <circle cx={333 + i * 530} cy={face + (c.h - face) / 2 - 2} r={2} fill={GOLD.light} />
        </g>
      ))}
    </g>
  );
};

export const trophyFront: Layer = (c) => {
  const glints = scatter(4, 2, (r, i) => ({ x: 180 + i * 520 + r.next() * 60 }));
  return (
    <g>
      <defs>
        {lin(c.id("frame"), [[0, WOOD.light], [0.5, WOOD.mid], [1, WOOD.dark]], true)}
        {lin(c.id("rail"), [[0, WOOD.light], [1, WOOD.dark]])}
        {lin(c.id("gleam"), [[0, "#ffffff", 0], [0.5, "#ffffff", 0.3], [1, "#ffffff", 0]], true)}
        {lin(c.id("glass"), [[0, "#ffffff", 0.07], [0.5, "#ffffff", 0], [1, "#bfe9e6", 0.05]])}
        {grainPattern(c.id("grainV"), false)}
        {grainPattern(c.id("grainF"), true)}
      </defs>
      {vignette(c, 0.3)}
      {/* the glass: a faint sheen, two still reflections, and a gleam that crosses now and then */}
      <rect x={FRAME_X} y={RAIL} width={SCENE_W - 2 * FRAME_X} height={c.h - RAIL} fill={c.url("glass")} />
      {glints.map((g, i) => (
        <path key={i} d={`M ${g.x} ${RAIL} L ${g.x + 70} ${RAIL} L ${g.x - 150} ${c.h} L ${g.x - 220} ${c.h} Z`} fill="#ffffff" opacity={0.05} />
      ))}
      <g {...c.motion("scn-glint", 11, -3)}>
        <path d={`M 150 ${RAIL} L 260 ${RAIL} L 40 ${c.h} L -70 ${c.h} Z`} fill={c.url("gleam")} opacity={c.animated ? 1 : 0} />
      </g>
      {/* the frame: grained stiles, a crowned top rail with a dentil row, a brass lock */}
      <rect x={0} y={0} width={FRAME_X} height={c.h} fill={c.url("frame")} stroke={INK} strokeWidth={3} />
      <rect x={0} y={0} width={FRAME_X} height={c.h} fill={c.url("grainV")} />
      <rect x={SCENE_W - FRAME_X} y={0} width={FRAME_X} height={c.h} fill={c.url("frame")} stroke={INK} strokeWidth={3} />
      <rect x={SCENE_W - FRAME_X} y={0} width={FRAME_X} height={c.h} fill={c.url("grainV")} />
      <rect x={0} y={0} width={SCENE_W} height={RAIL} fill={c.url("rail")} stroke={INK} strokeWidth={3} />
      <rect x={0} y={0} width={SCENE_W} height={RAIL} fill={c.url("grainF")} />
      {Array.from({ length: 60 }, (_, i) => (
        <rect key={i} x={i * 20 + 4} y={RAIL - 16} width={10} height={6} fill={WOOD.dark} opacity={0.55} />
      ))}
      <rect x={0} y={RAIL - 8} width={SCENE_W} height={4} fill={GOLD.mid} opacity={0.75} />
      <rect x={0} y={3} width={SCENE_W} height={3} fill="#c27a44" opacity={0.5} />
      <rect x={FRAME_X - 8} y={RAIL} width={8} height={c.h} fill={INK} opacity={0.35} />
      <rect x={SCENE_W - FRAME_X} y={RAIL} width={8} height={c.h} fill={INK} opacity={0.35} />
      <line x1={6} y1={RAIL} x2={6} y2={c.h} stroke="#b06a3a" strokeOpacity={0.5} strokeWidth={2} />
      <line x1={SCENE_W - FRAME_X + 6} y1={RAIL} x2={SCENE_W - FRAME_X + 6} y2={c.h} stroke="#b06a3a" strokeOpacity={0.5} strokeWidth={2} />
      <rect x={SCENE_W - FRAME_X + 14} y={c.G - 190} width={26} height={44} rx={5} fill={GOLD.mid} stroke={INK} strokeWidth={3} />
      <rect x={SCENE_W - FRAME_X + 17} y={c.G - 187} width={6} height={38} rx={3} fill={GOLD.light} opacity={0.7} />
      <circle cx={SCENE_W - FRAME_X + 27} cy={c.G - 172} r={5} fill={INK} />
    </g>
  );
};
