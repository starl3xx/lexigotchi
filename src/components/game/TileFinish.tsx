/**
 * The rarity finish of a letter tile (lib/rarityFinish says what each tier is made of).
 * Drawn inside TileCharacter's SVG, in its 240×340 space, in five layers:
 *   FinishDefs     gradients, textures, and the face's clip (inside the border)
 *   FinishAura     a soft glow behind the tile (Legendary, Mythic)
 *   FinishSurface  the material, under the letter: a translucent tint, then foil, glitter, frame,
 *                  facets, and the hot spot a light makes (it follows the pointer)
 *   FinishShine    light over the letter: the light passing, the glints, the fire
 *   FinishMotes    glowing motes drifting up around the tile (Legendary, Mythic)
 *
 * The light pass is what makes a tile feel like a material rather than a color: a broad soft glow
 * with a narrow bright streak inside it crosses the face on a slight curve, the face brightens as
 * it passes, and (Rare and up) the edge catches a glint as it leaves. It runs along the word, one
 * letter after the next (`index`).
 *
 * In WebKit, a tile whose light moves is drawn another way: the pieces of the light that move are
 * layers of their own (`momentPieces`, at the end of this file, says why), and the still ones here
 * are drawn between them. The picture is the same.
 *
 * Motion comes in MOMENTS (globals.css, `.rf-moment`): the light waits unseen, and the glints sit
 * lit, until the word's row carries .rf-moment (TileCharacter's useFinishMoment, every tier's
 * `period` seconds and when the pointer comes onto the word); then the light passes and the
 * glints twinkle, once, and it rests. Nothing ticks between moments, which is what keeps a slow
 * phone's main thread free. Only where the whole character is drawn, only with
 * prefers-reduced-motion: no-preference, never on a low-end device. A peckish word's shine
 * dims; a hungry one's is gone until it is fed. The pointer moves the hot spot through --rf-lx /
 * --rf-ly (0–1, set by whoever hosts the word). No blend modes: WebKit and Chromium blend inside a
 * clip differently.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Tier } from "@/lib/economy";
import { finishFor, mixHex, type Finish } from "@/lib/rarityFinish";
import { haloPath } from "./tileShapes";

/** "on": it has its moments · "off": a still frame (reduced motion, small sizes, a still scene) ·
 *  "rest": hungry, the shine gone until it is fed. Separately, `dim` (peckish) halves the shine,
 *  moving or still. */
export type FinishMotion = "on" | "off" | "rest";

// the rig's geometry (TileCharacter: tile 150×150 at 45,100)
const T = { x: 45, y: 100, w: 150, h: 150, r: 20 };
const CX = T.x + T.w / 2;
const MID = T.y + T.h / 2;
const BOT = T.y + T.h;
// the amethyst's bevel: thin, so the table (the flat centre) is big
const TABLE = 15;

const BOX: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };
const POINTER: CSSProperties = {
  transform: "translate(calc((var(--rf-lx, 0.35) - 0.5) * 140px), calc((var(--rf-ly, 0.3) - 0.5) * 100px))",
  transition: "transform 0.35s ease-out",
};

const id = (uid: string) => (name: string) => `rf-${name}-${uid}`;
const stops = (colors: string[]) => colors.map((c, i) => <stop key={i} offset={colors.length > 1 ? i / (colors.length - 1) : 0} stopColor={c} />);

/** The face inside the border (the border's inner edge). */
function inner(bw: number, inset = 0) {
  const k = bw / 2 + inset;
  return { x: T.x + k, y: T.y + k, width: T.w - 2 * k, height: T.h - 2 * k, rx: Math.max(2, T.r - k) };
}

/** One effect's run (globals.css: the light pass, the facets, the fire, the glints run 2.4 s). */
const MOMENT_S = 2.4;
/** A mote's rise (globals.css: rf-mote runs 3 s). */
const MOTE_S = 3;
/** How far behind its neighbour each letter's light starts: the light runs along the word. */
const STAGGER = 0.22;
/** The last letter's place in a five-letter word. */
const LAST = 4;
/** The latest a glint starts after its letter's turn (Mythic's second glint on an odd tile). */
const GLINT_AT = 1.5;
/** The latest a facet lights, as a fraction of the run (the right facet). */
const FACET_AT = 0.62;
/** When a mote starts: after the light, one by one, along the word. */
const moteDelay = (i: number, index: number, seed: number) => 0.4 + i * 0.3 + index * 0.15 + (seed % 3) * 0.1;
/**
 * When the last effect of a moment ends, in seconds: the latest of the last letter's light, facets,
 * glints, and motes. The word's row keeps .rf-moment this long (TileCharacter's useFinishMoment);
 * shorter, and the last effects would snap off mid-way.
 */
export const MOMENT_END_S = Math.max(
  LAST * STAGGER + FACET_AT * MOMENT_S + MOMENT_S,
  GLINT_AT + LAST * STAGGER + MOMENT_S,
  moteDelay(2, LAST, 2) + MOTE_S,
);
/** When an element starts within a moment: its letter's turn (the light runs along the word), plus
 *  `at`, a fraction of the run. */
const timing = (index: number, at = 0): CSSProperties => ({ animationDelay: `${(index * STAGGER + at * MOMENT_S).toFixed(2)}s` });

/** The four-point flare of a glint at (x, y), `s` its scale. */
export function glintFlare(x: number, y: number, s: number): string {
  const R = 16 * s;
  const r = 1.3 * s;
  return `M ${x} ${y - R} L ${x + r} ${y - r} L ${x + R} ${y} L ${x + r} ${y + r} L ${x} ${y + R} L ${x - r} ${y + r} L ${x - R} ${y} L ${x - r} ${y - r} Z`;
}

/**
 * A soft lens glint: a glow, a thin four-point flare, a hot core. No outline. Lit at rest, it
 * twinkles in a moment (`rf-glint`); `waits` keeps it unseen until its moment instead (the edge
 * catching the light as it leaves).
 */
export function Glint({ x, y, s, color, delay, anim, cls = "rf-glint", style, waits = false }: { x: number; y: number; s: number; color: string; delay: number; anim: boolean; cls?: string; style?: CSSProperties; waits?: boolean }) {
  const flare = glintFlare(x, y, s);
  return (
    <g className={anim ? cls : undefined} style={anim ? { ...BOX, animationDelay: `${delay}s`, ...style } : undefined} opacity={anim && waits ? 0 : undefined}>
      <circle cx={x} cy={y} r={9 * s} fill={color} opacity={0.35} />
      <circle cx={x} cy={y} r={5 * s} fill="#ffffff" opacity={0.55} />
      <path d={flare} fill="#ffffff" />
      <circle cx={x} cy={y} r={2 * s} fill="#ffffff" />
    </g>
  );
}

export function FinishDefs({ tier, uid, bw, small, motion }: { tier?: Tier; uid: string; bw: number; small: boolean; motion: FinishMotion }) {
  const fin = finishFor(tier);
  if (!fin) return null;
  const f = id(uid);
  // Only what this tile draws: a list's tiles are small and still, and each one used to carry all
  // thirteen gradients and patterns (the Dictionary draws 80 words, 400 tiles).
  const m = fin.material;
  const moving = motion === "on";
  const rich = m === "gold" || m === "amethyst";
  return (
    <defs>
      <linearGradient id={f("face")} x1="0" y1="0" x2="0.55" y2="1">
        {stops(fin.face)}
      </linearGradient>
      <clipPath id={f("clip")}>
        <rect {...inner(bw)} />
      </clipPath>
      {/* the light pass: a broad soft glow in the material's light, and a narrow streak */}
      {moving && (
        <linearGradient id={f("band")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={fin.glow} stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor={fin.glow} stopOpacity="0" />
        </linearGradient>
      )}
      {moving && (
        <linearGradient id={f("streak")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      )}
      {/* a broad, soft resting highlight */}
      {(m === "satin" || m === "gold") && (
        <linearGradient id={f("soft")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.1" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.28" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="0.46" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      )}
      {/* two crisp gloss streaks */}
      {m === "foil" && (
        <linearGradient id={f("gloss")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.26" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.36" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="0.44" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      )}
      {/* the hot spot a light makes on a polished surface */}
      {m !== "satin" && motion !== "rest" && (
        <radialGradient id={f("hot")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="0.4" stopColor={fin.glow} stopOpacity="0.3" />
          <stop offset="1" stopColor={fin.glow} stopOpacity="0" />
        </radialGradient>
      )}
      {/* brushed foil: fine diagonal lines, light and dark */}
      {m === "foil" && !small && (
        <pattern id={f("brush")} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)">
          <rect width="5" height="5" fill="none" />
          <line x1="0.5" y1="0" x2="0.5" y2="5" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.1" />
          <line x1="3" y1="0" x2="3" y2="5" stroke={fin.deep} strokeOpacity="0.1" strokeWidth="0.9" />
        </pattern>
      )}
      {/* glitter: fine bright specks */}
      {m === "gold" && !small && (
      <pattern id={f("glitter")} width="23" height="23" patternUnits="userSpaceOnUse">
        <rect width="23" height="23" fill="none" />
        <circle cx="3" cy="4" r="1.1" fill="#ffffff" opacity="0.95" />
        <circle cx="14" cy="2.5" r="0.7" fill="#ffffff" opacity="0.7" />
        <circle cx="19" cy="11" r="1.3" fill="#fffbe6" opacity="0.9" />
        <circle cx="8" cy="13" r="0.6" fill="#ffffff" opacity="0.6" />
        <circle cx="12" cy="19" r="1" fill="#ffffff" opacity="0.85" />
        <circle cx="2" cy="20" r="0.7" fill="#fff3c0" opacity="0.7" />
        <circle cx="21" cy="21" r="0.5" fill="#ffffff" opacity="0.6" />
      </pattern>
      )}
      {/* the amethyst's table: lit from the upper left */}
      {m === "amethyst" && (
        <radialGradient id={f("table")} cx="0.3" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor={fin.deep} stopOpacity="0.1" />
        </radialGradient>
      )}
      {/* fire: the spectrum a cut gem throws, along its edges */}
      {m === "amethyst" && !small && (
        <linearGradient id={f("fire")} gradientUnits="userSpaceOnUse" x1={T.x} y1={T.y} x2={T.x + T.w} y2={BOT}>
          <stop offset="0" stopColor="#ff7ad9" />
          <stop offset="0.25" stopColor="#ffd84d" />
          <stop offset="0.5" stopColor="#6ff2ff" />
          <stop offset="0.75" stopColor="#8f9bff" />
          <stop offset="1" stopColor="#ff7ad9" />
        </linearGradient>
      )}
      {/* glow for the motes (only moving). The halo behind the tile is line work and needs no paint (FinishAura). */}
      {rich && moving && (
        <radialGradient id={f("mote")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="0.3" stopColor={fin.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={fin.glow} stopOpacity="0" />
        </radialGradient>
      )}
    </defs>
  );
}

/** The halo's ink: between the material's light and its engraving shade, so it reads on pale paper and on a dark scene. */
export const haloInk = (fin: Finish) => mixHex(fin.glow, fin.deep, 0.42);

/**
 * The glow behind a Legendary or Mythic tile: an engraved halo of fine rays standing off the tile
 * (tileShapes, HALO, says how it is sized). It is around the letter, so it is drawn like the cards
 * (decisions.md #48, part 8); it was a soft blur. Still: it never moves.
 */
/** Whether a tile of this rarity and mood has a halo at all (a Legendary or Mythic one that is not asleep). */
export function finishHasAura(tier: Tier | undefined, motion: FinishMotion): boolean {
  const fin = finishFor(tier);
  return !!fin && motion !== "rest" && (fin.material === "amethyst" || fin.material === "gold");
}

export function FinishAura({ tier, outer, small, motion, dim }: { tier?: Tier; /** how far outside the tile's edge its own drawing ends (tileShapes, tileOuter) */ outer: number; /** a tile too small for it: rays a third of a pixel long are only a smudge */ small: boolean; motion: FinishMotion; dim: boolean }) {
  const fin = finishFor(tier);
  if (!fin || small || !finishHasAura(tier, motion)) return null;
  return <path data-halo="" d={haloPath(outer)} fill="none" stroke={haloInk(fin)} strokeWidth={1.3} strokeLinecap="round" opacity={dim ? 0.4 : 0.75} />;
}

/** Amethyst facets: four thin bevels between the face's edge and a big central table. (Also drawn
 *  by the share card's still, app/_og/tile.) */
export function facets() {
  const [x0, y0, x1, y1] = [T.x, T.y, T.x + T.w, T.y + T.h];
  const [a0, b0, a1, b1] = [x0 + TABLE, y0 + TABLE, x1 - TABLE, y1 - TABLE];
  return {
    top: `M ${x0} ${y0} L ${x1} ${y0} L ${a1} ${b0} L ${a0} ${b0} Z`,
    right: `M ${x1} ${y0} L ${x1} ${y1} L ${a1} ${b1} L ${a1} ${b0} Z`,
    bottom: `M ${x1} ${y1} L ${x0} ${y1} L ${a0} ${b1} L ${a1} ${b1} Z`,
    left: `M ${x0} ${y1} L ${x0} ${y0} L ${a0} ${b0} L ${a0} ${b1} Z`,
    table: { x: a0, y: b0, width: a1 - a0, height: b1 - b0, rx: 6 },
    edges: `M ${x0} ${y0} L ${a0} ${b0} M ${x1} ${y0} L ${a1} ${b0} M ${x1} ${y1} L ${a1} ${b1} M ${x0} ${y1} L ${a0} ${b1}`,
  };
}

/** The gold's engraved scrollwork for the top-left corner (the others mirror it; also drawn by the
 *  share card's still). */
export const SCROLL_PATH = (() => {
  const x = T.x + 15;
  const y = T.y + 15;
  return `M ${x} ${y + 34} C ${x} ${y + 14} ${x + 4} ${y + 4} ${x + 14} ${y + 1} C ${x + 22} ${y - 1} ${x + 30} ${y} ${x + 36} ${y} M ${x + 7} ${y + 22} C ${x + 6} ${y + 13} ${x + 12} ${y + 8} ${x + 18} ${y + 10} C ${x + 23} ${y + 12} ${x + 22} ${y + 19} ${x + 17} ${y + 19} C ${x + 13} ${y + 19} ${x + 13} ${y + 15} ${x + 16} ${y + 14}`;
})();
/** The four corners' mirror transforms, in the rig's space. */
export const SCROLL_MIRRORS = ["", `matrix(-1 0 0 1 ${2 * CX} 0)`, `matrix(1 0 0 -1 0 ${2 * MID})`, `matrix(-1 0 0 -1 ${2 * CX} ${2 * MID})`];

/** Engraved scrollwork for one corner (top left; the others mirror it). */
function Scroll({ fin }: { fin: Finish }) {
  const d = SCROLL_PATH;
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="#fff4c8" strokeWidth={2.2} transform="translate(1 1)" />
      <path d={d} stroke={fin.deep} strokeWidth={1.8} strokeOpacity={0.75} />
    </g>
  );
}

/** The material, under the letter. */
export function FinishSurface({ tier, uid, bw, small, motion }: { tier?: Tier; uid: string; bw: number; small: boolean; motion: FinishMotion }) {
  const fin = finishFor(tier);
  if (!fin) return null;
  const f = id(uid);
  const face = inner(bw);
  const hot = motion !== "rest" && fin.material !== "satin" && (
    <g style={POINTER}>
      <ellipse cx={T.x + 60} cy={T.y + 50} rx={66} ry={54} fill={`url(#${f("hot")})`} opacity={fin.material === "foil" ? 0.9 : 0.7} />
    </g>
  );
  const fc = facets();
  return (
    <g clipPath={`url(#${f("clip")})`}>
      {/* the material, a translucent tint: the tile's own cream or white shows through */}
      <rect {...face} fill={`url(#${f("face")})`} opacity={fin.alpha} />
      {fin.material === "satin" && <rect {...face} fill={`url(#${f("soft")})`} />}
      {fin.material === "foil" && (
        <>
          {!small && <rect {...face} fill={`url(#${f("brush")})`} />}
          <rect {...face} fill={`url(#${f("gloss")})`} />
        </>
      )}
      {fin.material === "gold" && (
        <>
          {!small && <rect {...face} fill={`url(#${f("glitter")})`} opacity={0.85} />}
          {!small && (
            <>
              <rect {...inner(bw, 9)} fill="none" stroke={fin.deep} strokeWidth={1.6} strokeOpacity={0.7} />
              <rect {...inner(bw, 11)} fill="none" stroke="#fff6d6" strokeWidth={1} />
              <Scroll fin={fin} />
              <g transform={`matrix(-1 0 0 1 ${2 * CX} 0)`}>
                <Scroll fin={fin} />
              </g>
              <g transform={`matrix(1 0 0 -1 0 ${2 * MID})`}>
                <Scroll fin={fin} />
              </g>
              <g transform={`matrix(-1 0 0 -1 ${2 * CX} ${2 * MID})`}>
                <Scroll fin={fin} />
              </g>
            </>
          )}
          <rect {...face} fill={`url(#${f("soft")})`} opacity={0.6} />
        </>
      )}
      {fin.material === "amethyst" && (
        <>
          {/* the bevels, lit from the upper left */}
          <path d={fc.top} fill="#ffffff" opacity={0.5} />
          <path d={fc.left} fill="#ffffff" opacity={0.22} />
          <path d={fc.right} fill={fin.deep} opacity={0.16} />
          <path d={fc.bottom} fill={fin.deep} opacity={0.28} />
          <rect {...fc.table} fill={`url(#${f("table")})`} />
          {!small && (
            <g fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.3}>
              <path d={fc.edges} />
              <rect {...fc.table} />
            </g>
          )}
          {/* a little fire at rest, so even the still shows it's a gem */}
          {!small && motion !== "rest" && (
            <g fill="none" stroke={`url(#${f("fire")})`} strokeWidth={1.6} opacity={0.35}>
              <rect {...fc.table} />
            </g>
          )}
        </>
      )}
      {hot}
    </g>
  );
}

// The light pass travels on a slight curve: a wide soft glow under the letter, and a narrow bright
// streak over it a little ahead. Both turn about the same point, so they move as one light.
const BAND = `M ${T.x - 70} ${T.y - 40} L ${T.x + 30} ${T.y - 40} L ${T.x - 30} ${BOT + 40} L ${T.x - 130} ${BOT + 40} Z`;
const STREAK = `M ${T.x - 14} ${T.y - 40} L ${T.x + 8} ${T.y - 40} L ${T.x - 52} ${BOT + 40} L ${T.x - 74} ${BOT + 40} Z`;
const PIVOT: CSSProperties = { transformBox: "view-box", transformOrigin: `${CX}px ${MID}px` };

/** The amethyst's facets in the order the light reaches them, each with when it lights (a fraction of the run). */
const FACET_RUN = [
  ["left", 0.12],
  ["top", 0.35],
  ["bottom", 0.4],
  ["right", FACET_AT],
] as const;
/** The edge catching the light as it leaves: where, and how big. */
const EDGE_GLINT = [T.x + T.w - 16, T.y + 18, 0.7] as const;
/** The soft glints that come and go: one a tile (two on Mythic), placed by the tile's place in the word. */
function glintSpots(fin: Finish, index: number): { x: number; y: number; s: number; color: string; delay: number }[] {
  const even = index % 2 === 0;
  const out = [even ? { x: T.x + 26, y: T.y + 40, s: 0.9, color: fin.glow, delay: 0.8 + index * STAGGER } : { x: T.x + T.w - 24, y: MID + 40, s: 0.7, color: fin.glow, delay: 1.1 + index * STAGGER }];
  if (fin.material === "amethyst") out.push(even ? { x: T.x + 30, y: BOT - 26, s: 0.6, color: "#8ff2ff", delay: 1.3 + index * STAGGER } : { x: CX + 30, y: T.y + 30, s: 0.55, color: "#ff9be3", delay: GLINT_AT + index * STAGGER });
  return out;
}
/** Where a tile's motes start: three on Mythic, two on Legendary. */
function moteSpots(fin: Finish): { x: number; y: number; r: number }[] {
  return [
    { x: T.x - 6, y: MID + 30, r: 4.5 },
    { x: T.x + T.w + 8, y: MID + 10, r: 3.5 },
    { x: T.x + 22, y: BOT - 4, r: 3 },
    { x: T.x + T.w - 18, y: BOT - 8, r: 4 },
    { x: CX + 6, y: T.y + 30, r: 3 },
    { x: T.x - 10, y: T.y + 40, r: 3.5 },
  ].slice(0, fin.material === "amethyst" ? 3 : 2);
}

/** Light under the letter: the face brightening and the broad glow of the light passing. */
export function FinishLight({ tier, uid, bw, motion, dim, index }: { tier?: Tier; uid: string; bw: number; motion: FinishMotion; dim: boolean; index: number }) {
  const fin = finishFor(tier);
  if (!fin || motion !== "on") return null;
  const f = id(uid);
  const rich = fin.material === "gold" || fin.material === "amethyst";
  return (
    <g clipPath={`url(#${f("clip")})`} opacity={dim ? 0.45 : 1}>
      <rect {...inner(bw)} fill="#ffffff" fillOpacity={rich ? 0.22 : 0.16} className="rf-catch" style={timing(index)} opacity={0} />
      <path d={BAND} fill={`url(#${f("band")})`} className="rf-pass" style={{ ...PIVOT, ...timing(index) }} opacity={0} />
    </g>
  );
}

/** Light over the letter. */
export function FinishShine({ tier, uid, bw, motion, dim, small, index }: { tier?: Tier; uid: string; bw: number; motion: FinishMotion; dim: boolean; small: boolean; index: number }) {
  const fin = finishFor(tier);
  if (!fin || motion === "rest") return null;
  const f = id(uid);
  const anim = motion === "on";
  const fc = facets();
  const rich = fin.material === "gold" || fin.material === "amethyst";
  return (
    <g opacity={dim ? 0.45 : 1}>
      <g clipPath={`url(#${f("clip")})`}>
        {/* the bright streak of the light passing: thin, so the letter stays readable */}
        {anim && <path d={STREAK} fill={`url(#${f("streak")})`} className="rf-pass" style={{ ...PIVOT, ...timing(index) }} opacity={0} />}
        {/* the light running across the amethyst's facets, left to right as the pass goes by */}
        {fin.material === "amethyst" && anim && !small && (
          <g fill="#ffffff">
            {FACET_RUN.map(([side, at], i) => (
              <path key={i} d={fc[side]} className="rf-facet" style={timing(index, at)} opacity={0} />
            ))}
          </g>
        )}
        {/* fire: spectral flashes along the facet edges just after the light passes */}
        {fin.material === "amethyst" && anim && !small && (
          <g fill="none" stroke={`url(#${f("fire")})`} strokeWidth={2.2} strokeLinecap="round" className="rf-fire" style={timing(index, 0.5)} opacity={0}>
            <path d={fc.edges} />
            <rect {...fc.table} />
          </g>
        )}
      </g>
      {/* (No light circling the rim: animating a stroke's dash re-strokes the outline every frame,
          and on a 4×-slowed CPU it alone took a Legendary word's moment from 62% to 97%.) */}
      {/* the edge catching the light as it leaves (Rare and up) */}
      {fin.material !== "satin" && !small && anim && !dim && (
        <Glint x={EDGE_GLINT[0]} y={EDGE_GLINT[1]} s={EDGE_GLINT[2]} color={fin.glow} delay={0} anim cls="rf-edge" style={timing(index, 0)} waits />
      )}
      {/* soft glints that come and go: one a tile (two on Mythic), placed by the tile's place in the word */}
      {rich && !small && !dim && (
        <>
          {glintSpots(fin, index).map((g, i) => (
            <Glint key={i} x={g.x} y={g.y} s={g.s} color={g.color} delay={g.delay} anim={anim} />
          ))}
        </>
      )}
    </g>
  );
}

/** Whether a tile has motes: a moving Legendary or Mythic one, not peckish, on every other tile. */
export function finishHasMotes(tier: Tier | undefined, motion: FinishMotion, dim: boolean, index: number): boolean {
  const fin = finishFor(tier);
  return !!fin && motion === "on" && !dim && index % 2 === 0 && (fin.material === "amethyst" || fin.material === "gold");
}

/** Glowing motes drifting up around the word: on every other tile only, a few each. */
export function FinishMotes({ tier, uid, motion, dim, seed, index }: { tier?: Tier; uid: string; motion: FinishMotion; dim: boolean; seed: number; index: number }) {
  const fin = finishFor(tier);
  if (!fin || !finishHasMotes(tier, motion, dim, index)) return null;
  const spots = moteSpots(fin);
  // they rise after the light has passed, staggered along the word (moteDelay; MOMENT_END_S counts it)
  return (
    <g pointerEvents="none">
      {spots.map((m, i) => (
        <g key={i} className="rf-mote" style={{ ...BOX, animationDelay: `${moteDelay(i, index, seed).toFixed(2)}s` }} opacity={0}>
          <circle cx={m.x} cy={m.y} r={m.r * 2.4} fill={`url(#${id(uid)("mote")})`} />
          <circle cx={m.x} cy={m.y} r={m.r * 0.45} fill="#ffffff" />
        </g>
      ))}
    </g>
  );
}

// ── A moment, as layers ─────────────────────────────────────────────────────────────────────────
// The same light as FinishLight, FinishShine and FinishMotes draw, one LAYER a piece (TileCharacter
// draws each as its own <svg>, and the moment's animation runs on that <svg>). WebKit needs it this
// way: a shape that moves INSIDE an <svg> costs it the same however little that <svg> holds (two
// motes alone, in a drawing of their own, took a Legendary word from 10% of a processor core to
// 28%), and far less when the <svg> itself moves. The components above still draw the light inside
// the one drawing: for every other engine (TileCharacter's useWebKit has the numbers), and for a
// picture in a single file. tests/tile-character.test.tsx holds the two in step: the same pieces,
// at the same times.

/** One moving piece of a moment: still shapes, and how its layer moves. */
export interface MomentPiece {
  key: string;
  /**
   * Its keyframes (globals.css, `.rf-moment .rf-*`), run on the layer. A piece that only fades or
   * turns shares the single drawing's keyframes. One that travels has its own (`rf-passing` for
   * `rf-pass`, `rf-rising` for `rf-mote`): the same move, with its distances in the drawing's
   * units, because a px on a layer is the screen's and a px on a shape is the drawing's.
   */
  cls: "rf-catch" | "rf-passing" | "rf-facet" | "rf-fire" | "rf-edge" | "rf-glint" | "rf-rising";
  /**
   * How the layer sits on a leaning tile, and how it rises with it on a hover:
   * - "leaned": it only fades. The lean and the hover's rise are inside its drawing, as they are
   *   in the tile's own.
   * - "point": it turns and grows about `origin`. The lean is inside its drawing (exact, and a
   *   glint is seen at rest), and `origin` is that point on the leaned tile. The hover's rise is
   *   a layer OUTSIDE it: inside, the layer's own turn would swing the risen glint round a point
   *   that had not risen (a quarter turn puts it six units to the side: Bugbot on #237).
   * - "cut": it travels across the face and is cut at the face's edge by a shape that stays put,
   *   so the lean, the cut, and the piece are layers one inside the next (the light passing).
   * - "upright": it travels in the tile's leaned frame with no cut (a mote rising).
   */
  frame: "leaned" | "point" | "cut" | "upright";
  /** The point the layer turns and grows about, in the rig's upright units (none: it only fades). */
  origin?: readonly [number, number];
  /** When it starts within the moment, in seconds. */
  delay: number;
  /** Unseen between moments. (A glint is lit at rest: it twinkles in a moment.) */
  waits: boolean;
  children: ReactNode;
}

/** A tile's moment, piece by piece, in the order the body is painted. */
export interface Moment {
  /** Under the letter: the face brightening, the broad glow passing. */
  under: MomentPiece[];
  /** Over the letter and under the eyes: the streak, the facets, the fire, the edge's glint, the glints. */
  over: MomentPiece[];
  /** Over everything: the motes. */
  motes: MomentPiece[];
  /** How strongly the two lights show, as one group each (a peckish word's shine is dimmed). */
  opacity: number;
}

/** The face inside the border, in the rig's units: what cuts the passing light. */
export function finishFace(bw: number) {
  return inner(bw);
}

/** A moving tile's moment as layers (`motion` "on" only: a still tile has no moment). */
export function momentPieces({ tier, uid, bw, dim, seed, index }: { tier?: Tier; uid: string; bw: number; dim: boolean; seed: number; index: number }): Moment | null {
  const fin = finishFor(tier);
  if (!fin) return null;
  const f = id(uid);
  const fc = facets();
  const rich = fin.material === "gold" || fin.material === "amethyst";
  const at = (frac = 0) => index * STAGGER + frac * MOMENT_S;
  // a piece that only fades is cut at the face's edge inside its own drawing, as the single body cuts it
  const cut = (children: ReactNode) => <g clipPath={`url(#${f("clip")})`}>{children}</g>;
  const glintShapes = (x: number, y: number, s: number, color: string) => (
    <>
      <circle cx={x} cy={y} r={9 * s} fill={color} opacity={0.35} />
      <circle cx={x} cy={y} r={5 * s} fill="#ffffff" opacity={0.55} />
      <path d={glintFlare(x, y, s)} fill="#ffffff" />
      <circle cx={x} cy={y} r={2 * s} fill="#ffffff" />
    </>
  );

  const under: MomentPiece[] = [
    { key: "catch", cls: "rf-catch", frame: "leaned", delay: at(), waits: true, children: cut(<rect {...inner(bw)} fill="#ffffff" fillOpacity={rich ? 0.22 : 0.16} />) },
    { key: "band", cls: "rf-passing", frame: "cut", origin: [CX, MID], delay: at(), waits: true, children: <path d={BAND} fill={`url(#${f("band")})`} /> },
  ];
  const over: MomentPiece[] = [{ key: "streak", cls: "rf-passing", frame: "cut", origin: [CX, MID], delay: at(), waits: true, children: <path d={STREAK} fill={`url(#${f("streak")})`} /> }];
  if (fin.material === "amethyst") {
    FACET_RUN.forEach(([side, frac]) => over.push({ key: `facet-${side}`, cls: "rf-facet", frame: "leaned", delay: at(frac), waits: true, children: cut(<path d={fc[side]} fill="#ffffff" />) }));
    over.push({
      key: "fire",
      cls: "rf-fire",
      frame: "leaned",
      delay: at(0.5),
      waits: true,
      children: cut(
        <g fill="none" stroke={`url(#${f("fire")})`} strokeWidth={2.2} strokeLinecap="round">
          <path d={fc.edges} />
          <rect {...fc.table} />
        </g>,
      ),
    });
  }
  if (fin.material !== "satin" && !dim) {
    const [x, y, sc] = EDGE_GLINT;
    over.push({ key: "edge", cls: "rf-edge", frame: "point", origin: [x, y], delay: at(), waits: true, children: glintShapes(x, y, sc, fin.glow) });
  }
  if (rich && !dim) glintSpots(fin, index).forEach((g, i) => over.push({ key: `glint${i}`, cls: "rf-glint", frame: "point", origin: [g.x, g.y], delay: g.delay, waits: false, children: glintShapes(g.x, g.y, g.s, g.color) }));
  const motes: MomentPiece[] = finishHasMotes(tier, "on", dim, index)
    ? moteSpots(fin).map((m, i) => ({
        key: `mote${i}`,
        cls: "rf-rising" as const,
        frame: "upright" as const,
        origin: [m.x, m.y] as const,
        delay: moteDelay(i, index, seed),
        waits: true,
        children: (
          <>
            <circle cx={m.x} cy={m.y} r={m.r * 2.4} fill={`url(#${id(uid)("mote")})`} />
            <circle cx={m.x} cy={m.y} r={m.r * 0.45} fill="#ffffff" />
          </>
        ),
      }))
    : [];
  return { under, over, motes, opacity: dim ? 0.45 : 1 };
}
