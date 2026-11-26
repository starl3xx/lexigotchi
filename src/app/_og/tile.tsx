import type { ReactElement } from "react";
import type { Tier } from "@/lib/economy";
import { finishFor, type Finish } from "@/lib/rarityFinish";
import { facets, glintFlare, SCROLL_MIRRORS, SCROLL_PATH } from "@/components/game/TileFinish";

import {
  ARM_REST,
  ARM_REST_R,
  BOT,
  CLASP,
  CX,
  DARTS_FROM,
  FOOT_LX,
  FOOT_RX,
  FOOT_Y,
  HOLO_STOPS,
  LAUREL_LEAF,
  LEG_L,
  LEG_R,
  LIMB_W,
  LINK_L,
  LINK_R,
  MID,
  MITT,
  PIP_NUDGE,
  PITCH,
  SHADOW_LINES,
  SHADOW_LINE_OPACITY,
  SHINE_FROM,
  SHOE,
  SHOE_SHINE,
  T,
  VB,
  eyeBox,
  laurel,
  mittAt,
  pipPath,
  pupilOf,
  ringOuter,
  ringRects,
  type Hand,
  type RingPart,
} from "@/components/game/tileShapes";

/**
 * A static vaudeville tile character built for Satori (next/og). The real rig (`TileCharacter`)
 * is a "use client" SVG component with `<text>`, filters and CSS animation, none of which Satori
 * renders, so this is a purpose-built, idle, Satori-safe twin: inline SVG *shapes* for the tile,
 * eyes, noodle limbs, mitts and bean shoes, with the printed letter overlaid as Söhne `<div>` text
 * (the only way to get real glyphs into an ImageResponse).
 *
 * Every shape's numbers come from components/game/tileShapes, the same file the rig draws from, so
 * the card can't drift from the game (it had: arms at rest inside a word, simpler eyes). In a word
 * the letters hold hands and lean as they do in the app (`linkLeft` / `linkRight`, `lean`).
 *
 * The word's rarity is drawn as the app draws a still finish (components/game/TileFinish, motion
 * "off"): the aura behind the tile, the material over the face, the border again, the letter,
 * then the glints over it, in a second svg above the letter. Satori's rules hold here as in the
 * scenes (scenes/kit.tsx): only plain SVG elements, built by functions, never a component or a
 * fragment inside an `<svg>`, and no attribute left undefined (so a lean of 0 is still a real
 * rotate: Satori drops a group whose transform it can't read).
 */

const INK = "#2a1e1a";
const TILE_FACE = "#f8efdd";
const EDGE_WOOD = "#c7ae84";
const LHAW = "#3b82f6";
const LHAW_RING = "#bbd1fd";
const LHAW_INK = "#111827";
// the gilding's paints, as the rig's (TileCharacter)
const BRASS = "#c8962b";
const GOLD = "#f0a617";
const SHEEN = "#fce8a8";
const EYE_WHITE = "#ffffff";

/** The face inside the border (the border's inner edge). */
function inner(bw: number, inset = 0) {
  const k = bw / 2 + inset;
  return { x: T.x + k, y: T.y + k, width: T.w - 2 * k, height: T.h - 2 * k, rx: Math.max(2, T.r - k) };
}

const stops = (colors: string[]) => colors.map((c, i) => <stop key={i} offset={colors.length > 1 ? i / (colors.length - 1) : 0} stopColor={c} />);

/** The gradients, textures and the face's clip a finish draws with. */
function finishDefs(fin: Finish, u: (n: string) => string, bw: number): ReactElement {
  return (
    <defs>
      <linearGradient id={u("face")} x1="0" y1="0" x2="0.55" y2="1">
        {stops(fin.face)}
      </linearGradient>
      <clipPath id={u("clip")}>
        <rect {...inner(bw)} />
      </clipPath>
      <linearGradient id={u("soft")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0.1" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="0.28" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="0.46" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={u("gloss")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0.26" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="0.36" stopColor="#ffffff" stopOpacity="0.6" />
        <stop offset="0.44" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.35" />
        <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={u("hot")} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
        <stop offset="0.4" stopColor={fin.glow} stopOpacity="0.3" />
        <stop offset="1" stopColor={fin.glow} stopOpacity="0" />
      </radialGradient>
      <pattern id={u("brush")} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)">
        <line x1="0.5" y1="0" x2="0.5" y2="5" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.1" />
        <line x1="3" y1="0" x2="3" y2="5" stroke={fin.deep} strokeOpacity="0.1" strokeWidth="0.9" />
      </pattern>
      <pattern id={u("glitter")} width="23" height="23" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="4" r="1.1" fill="#ffffff" opacity="0.95" />
        <circle cx="14" cy="2.5" r="0.7" fill="#ffffff" opacity="0.7" />
        <circle cx="19" cy="11" r="1.3" fill="#fffbe6" opacity="0.9" />
        <circle cx="8" cy="13" r="0.6" fill="#ffffff" opacity="0.6" />
        <circle cx="12" cy="19" r="1" fill="#ffffff" opacity="0.85" />
        <circle cx="2" cy="20" r="0.7" fill="#fff3c0" opacity="0.7" />
        <circle cx="21" cy="21" r="0.5" fill="#ffffff" opacity="0.6" />
      </pattern>
      <radialGradient id={u("table")} cx="0.3" cy="0.25" r="0.8">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.08" />
        <stop offset="1" stopColor={fin.deep} stopOpacity="0.1" />
      </radialGradient>
      <linearGradient id={u("fire")} gradientUnits="userSpaceOnUse" x1={T.x} y1={T.y} x2={T.x + T.w} y2={BOT}>
        <stop offset="0" stopColor="#ff7ad9" />
        <stop offset="0.25" stopColor="#ffd84d" />
        <stop offset="0.5" stopColor="#6ff2ff" />
        <stop offset="0.75" stopColor="#8f9bff" />
        <stop offset="1" stopColor="#ff7ad9" />
      </linearGradient>
      <radialGradient id={u("aura")} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.62" stopColor={fin.glow} stopOpacity="0.75" />
        <stop offset="0.8" stopColor={fin.glow} stopOpacity="0.28" />
        <stop offset="1" stopColor={fin.glow} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** A soft glow hugging the tile, behind it (Legendary, Mythic). */
function finishAura(fin: Finish, u: (n: string) => string): ReactElement | null {
  if (fin.material !== "amethyst" && fin.material !== "gold") return null;
  const pad = fin.material === "amethyst" ? 26 : 22;
  return <rect x={T.x - pad} y={T.y - pad} width={T.w + 2 * pad} height={T.h + 2 * pad} rx={T.r + pad} fill={`url(#${u("aura")})`} opacity={0.75} />;
}

/** The material over the face, under the letter: as TileFinish's FinishSurface draws it still. */
function finishSurface(fin: Finish, u: (n: string) => string, bw: number): ReactElement {
  const face = inner(bw);
  const url = (n: string) => `url(#${u(n)})`;
  const fc = facets();
  const parts: ReactElement[] = [<rect key="tint" {...face} fill={url("face")} opacity={fin.alpha} />];
  if (fin.material === "satin") parts.push(<rect key="soft" {...face} fill={url("soft")} />);
  if (fin.material === "foil") {
    parts.push(<rect key="brush" {...face} fill={url("brush")} />, <rect key="gloss" {...face} fill={url("gloss")} />);
  }
  if (fin.material === "gold") {
    parts.push(
      <rect key="glitter" {...face} fill={url("glitter")} opacity={0.85} />,
      <rect key="frame" {...inner(bw, 9)} fill="none" stroke={fin.deep} strokeWidth={1.6} strokeOpacity={0.7} />,
      <rect key="frame2" {...inner(bw, 11)} fill="none" stroke="#fff6d6" strokeWidth={1} />,
      ...SCROLL_MIRRORS.map((m, i) => (
        <g key={`scroll${i}`} fill="none" strokeLinecap="round" {...(m ? { transform: m } : {})}>
          <path d={SCROLL_PATH} stroke="#fff4c8" strokeWidth={2.2} transform="translate(1 1)" />
          <path d={SCROLL_PATH} stroke={fin.deep} strokeWidth={1.8} strokeOpacity={0.75} />
        </g>
      )),
      <rect key="soft" {...face} fill={url("soft")} opacity={0.6} />,
    );
  }
  if (fin.material === "amethyst") {
    parts.push(
      <path key="top" d={fc.top} fill="#ffffff" opacity={0.5} />,
      <path key="left" d={fc.left} fill="#ffffff" opacity={0.22} />,
      <path key="right" d={fc.right} fill={fin.deep} opacity={0.16} />,
      <path key="bottom" d={fc.bottom} fill={fin.deep} opacity={0.28} />,
      <rect key="table" {...fc.table} fill={url("table")} />,
      <g key="edges" fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.3}>
        <path d={fc.edges} />
        <rect {...fc.table} />
      </g>,
      <rect key="fire" {...fc.table} fill="none" stroke={url("fire")} strokeWidth={1.6} opacity={0.35} />,
    );
  }
  // the hot spot a light makes, where the app's resting light sits (TileFinish's POINTER at its
  // default, 0.35 / 0.3: 21 left of and 20 above its centre)
  if (fin.material !== "satin") {
    parts.push(<ellipse key="hot" cx={T.x + 60 - 21} cy={T.y + 50 - 20} rx={66} ry={54} fill={url("hot")} opacity={fin.material === "foil" ? 0.9 : 0.7} />);
  }
  return <g clipPath={url("clip")}>{parts}</g>;
}

/** A soft lens glint, lit (TileFinish's Glint at rest). */
function glint(key: string, x: number, y: number, s: number, color: string): ReactElement {
  return (
    <g key={key}>
      <circle cx={x} cy={y} r={9 * s} fill={color} opacity={0.35} />
      <circle cx={x} cy={y} r={5 * s} fill="#ffffff" opacity={0.55} />
      <path d={glintFlare(x, y, s)} fill="#ffffff" />
      <circle cx={x} cy={y} r={2 * s} fill="#ffffff" />
    </g>
  );
}

/** The glints over the letter (Legendary, Mythic), one a tile and two on Mythic, placed by the
 *  tile's place in the word, as in the app. */
function finishGlints(fin: Finish, index: number): ReactElement[] {
  if (fin.material !== "gold" && fin.material !== "amethyst") return [];
  const even = index % 2 === 0;
  const out = [even ? glint("g1", T.x + 26, T.y + 40, 0.9, fin.glow) : glint("g1", T.x + T.w - 24, MID + 40, 0.7, fin.glow)];
  if (fin.material === "amethyst") out.push(even ? glint("g2", T.x + 30, BOT - 26, 0.6, "#8ff2ff") : glint("g2", CX + 30, T.y + 30, 0.55, "#ff9be3"));
  return out;
}

const limb = (key: string, d: string): ReactElement => <path key={key} d={d} stroke={INK} strokeWidth={LIMB_W} fill="none" strokeLinecap="round" />;

/** A mitt at a hand (tileShapes, MITT): a thumb, a palm, a cuff, and on big tiles two stitches. */
function mitt(key: string, hand: Hand, darts: boolean): ReactElement {
  const { thumb, palm, cuff } = MITT;
  return (
    <g key={key} transform={mittAt(hand)}>
      <ellipse cx={thumb.cx} cy={thumb.cy} rx={thumb.rx} ry={thumb.ry} transform={`rotate(${thumb.rot} ${thumb.cx} ${thumb.cy})`} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <ellipse {...palm} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      {darts ? <path d={MITT.darts} stroke={INK} strokeWidth={1.7} strokeLinecap="round" fill="none" /> : null}
      <rect {...cuff} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
    </g>
  );
}

/**
 * The hands two letters hold (tileShapes, CLASP). The rig lets the letter on the right draw both
 * hands, a little past its own left edge; Satori clips a drawing to its box, so here each letter
 * draws its own hand: the left letter the hand under (`mine: "under"`, carried one letter's pitch
 * to the right into its own space), the right letter its thumb and the hand over. The right letter
 * is the later sibling, so its hand still lands on top.
 */
function claspHalf(mine: "under" | "over", darts: boolean): ReactElement {
  const { cuff, cuffs, under, thumb, over } = CLASP;
  if (mine === "under") {
    return (
      <g key="clasp-under" transform={`translate(${PITCH} 0)`}>
        <rect {...cuff} transform={cuffs[0]} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
        <ellipse {...under} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      </g>
    );
  }
  return (
    <g key="clasp-over">
      <rect {...cuff} transform={cuffs[1]} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <ellipse cx={thumb.cx} cy={thumb.cy} rx={thumb.rx} ry={thumb.ry} transform={`rotate(${thumb.rot} ${thumb.cx} ${thumb.cy})`} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <ellipse {...over} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      {darts ? <path d={CLASP.darts} stroke={INK} strokeWidth={1.7} strokeLinecap="round" fill="none" /> : null}
    </g>
  );
}

/** The laurels (tileShapes, laurel): the left sprig, and its mirror. Every attribute given, for Satori. */
function laurels(paint: string): ReactElement {
  const l = laurel(ringOuter(4));
  const sprig = (k: string) => [
    <path key={`${k}-stem`} d={l.stem} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />,
    ...l.leaves.map((t, i) => <path key={`${k}-${i}`} d={LAUREL_LEAF} transform={t} fill={paint} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />),
  ];
  return (
    <g key="laurels">
      {sprig("l")}
      <g transform={`translate(${VB.w} 0) scale(-1 1)`}>{sprig("r")}</g>
    </g>
  );
}

/** An open eye at rest (tileShapes: eyeBox, pupilOf): a tall oval, one big pupil, its pie cut. */
function eye(key: string, ex: number, ey: number, rx: number, ry: number, side: -1 | 1): ReactElement {
  const p = pupilOf(ex, ey, rx, ry, side);
  return (
    <g key={key}>
      <ellipse cx={ex} cy={ey} rx={rx} ry={ry} fill={EYE_WHITE} stroke={INK} strokeWidth={3.2} />
      <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={INK} />
      <path d={p.cut} fill={EYE_WHITE} />
    </g>
  );
}

export function OgTile({
  char,
  upper = false,
  w = 200,
  limbs = true,
  tier,
  gild = 0,
  index = 0,
  uid = "t",
  linkLeft = false,
  linkRight = false,
  lean = 0,
}: {
  char: string;
  upper?: boolean;
  w?: number;
  limbs?: boolean;
  /** The word's rarity, worn as the tile's material (lib/rarityFinish), as a still. */
  tier?: Tier;
  /**
   * The word's ascension stage, worn by its UPPERCASE letters as in the game (decisions.md #48):
   * slim rings, black diamond pips, laurels from Gilded 4, the foil at Holographic. The caller
   * reads it from the chain; a link can't claim one.
   */
  gild?: number;
  /** The tile's place in its word: the glints alternate along a word, as in the app. */
  index?: number;
  /** Keeps this tile's gradient and clip ids apart from its neighbours'. */
  uid?: string;
  /** This letter holds its left / right neighbour's hand (a word), as in the app. */
  linkLeft?: boolean;
  linkRight?: boolean;
  /** Its resting lean in degrees, about its feet (tileShapes, leanFor). */
  lean?: number;
}): ReactElement {
  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  // crop: full character (with limbs) vs a tight tile+head box (icon)
  const vb = limbs ? { x: 0, y: 0, W: 240, H: 340 } : { x: 18, y: 70, W: 204, H: 204 };
  const h = Math.round((w * vb.H) / vb.W);
  const sx = w / vb.W;
  const sy = h / vb.H;

  // letter overlay placed exactly over the tile face (45,100,150,150 in viewBox space)
  const faceLeft = (T.x - vb.x) * sx;
  const faceTop = (T.y - vb.y) * sy;
  const faceSize = T.w * sx;
  // the stage, on UPPERCASE letters only, as in the rig
  const g = upper ? Math.max(0, Math.min(5, Math.round(gild) || 0)) : 0;
  const holo = g >= 5 ? `url(#rf-holo-${uid})` : undefined;
  const ringPaint = (part: RingPart) => (part === "plain" ? LHAW_RING : part === "gold" ? (holo ?? BRASS) : g >= 5 ? "#ffffff" : SHEEN);
  // the eyes ride the ring's outer edge
  const eyes = eyeBox(upper, ringOuter(g));
  const fin = finishFor(tier);
  const bw = upper ? 12 : 4; // the face's border
  const u = (n: string) => `rf-${n}-${uid}`;
  const border = <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill="none" stroke={upper ? LHAW : INK} strokeWidth={bw} />;
  const glints = fin ? finishGlints(fin, index) : [];
  // the lean, about the feet; the shoes, the shadow, and the held hands stay upright
  const tilt = `rotate(${lean} ${CX} ${BOT})`;
  const darts = w >= DARTS_FROM;
  const foot = (x: number, flip: 1 | -1) => `translate(${x} ${FOOT_Y}) scale(${flip} 1)`;

  return (
    <div style={{ position: "relative", display: "flex", width: w, height: h }}>
      <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.W} ${vb.H}`} style={{ position: "absolute", left: 0, top: 0 }}>
        {fin && finishDefs(fin, u, bw)}
        {holo && (
          <defs>
            <linearGradient id={`rf-holo-${uid}`} x1="0" y1="0" x2="0.6" y2="0.6" spreadMethod="reflect">
              {HOLO_STOPS.map(([o, c]) => (
                <stop key={o} offset={o} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
        )}
        {limbs && (
          <g>
            {/* the ground shadow as ruled lines (tileShapes, SHADOW_LINES): every attribute given, for Satori */}
            {SHADOW_LINES.map((l) => (
              <path key={l.y} d={`M ${l.x0} ${l.y} H ${l.x1}`} fill="none" stroke={INK} strokeOpacity={SHADOW_LINE_OPACITY} strokeWidth={l.w} strokeLinecap="round" />
            ))}
            <path d={SHOE} transform={foot(FOOT_LX, -1)} fill={INK} />
            <path d={SHOE} transform={foot(FOOT_RX, 1)} fill={INK} />
            {w >= SHINE_FROM ? <path d={SHOE_SHINE} transform={foot(FOOT_LX, -1)} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={2.2} strokeLinecap="round" fill="none" /> : null}
            {w >= SHINE_FROM ? <path d={SHOE_SHINE} transform={foot(FOOT_RX, 1)} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={2.2} strokeLinecap="round" fill="none" /> : null}
          </g>
        )}

        {/* behind the arms: the rarity's aura, the case's ring or wooden edge, and the legs. The legs
            come over an UPPERCASE letter's ring and under its face, as the arms do (decisions.md #48). */}
        <g transform={tilt}>
          {fin && finishAura(fin, u)}
          {upper ? ringRects(g).map((r, i) => <rect key={`ring-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="none" stroke={ringPaint(r.part)} strokeWidth={r.sw} />) : null}
          {limbs ? limb("leg-l", LEG_L) : null}
          {limbs ? limb("leg-r", LEG_R) : null}
          {upper ? null : <rect x={T.x} y={T.y + 7} width={T.w} height={T.h} rx={T.r} fill={EDGE_WOOD} />}
        </g>

        {/* the arms that reach for a neighbour's hand: upright, over the ring and under the face */}
        {limbs && linkLeft ? limb("link-l", LINK_L) : null}
        {limbs && linkRight ? limb("link-r", LINK_R) : null}

        <g transform={tilt}>
          {/* the free arms hang at rest, each ending in its mitt */}
          {limbs && !linkLeft ? limb("arm-l", ARM_REST.d) : null}
          {limbs && !linkLeft ? mitt("mitt-l", ARM_REST.hand, darts) : null}
          {limbs && !linkRight ? limb("arm-r", ARM_REST_R.d) : null}
          {limbs && !linkRight ? mitt("mitt-r", ARM_REST_R.hand, darts) : null}

          {/* tile face */}
          <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={upper ? "#ffffff" : TILE_FACE} stroke={upper ? LHAW : INK} strokeWidth={bw} />
          {/* the rarity's material over the face, then the border again over its edge */}
          {fin && finishSurface(fin, u, bw)}
          {fin && border}

          {/* the laurels of a Gilded 4 or Holographic letter (a whole character only); the stage's pips are drawn last, over the glints */}
          {limbs && g >= 4 ? laurels(holo ?? GOLD) : null}

          {/* pie-eyes on the top edge, wide open */}
          {eye("eye-l", CX - eyes.dx, eyes.y, eyes.rx, eyes.ry, -1)}
          {eye("eye-r", CX + eyes.dx, eyes.y, eyes.rx, eyes.ry, 1)}
        </g>

        {/* the held hands, on top (claspHalf says why each letter draws its own) */}
        {limbs && linkRight ? claspHalf("under", darts) : null}
        {limbs && linkLeft ? claspHalf("over", darts) : null}
      </svg>

      {/* the printed letter — Söhne via Satori text, centred on the tile face, leaning with it
          (the face's bottom centre is the feet's pivot's x, so the lean turns about 50% 100%) */}
      <div
        style={{
          position: "absolute",
          left: faceLeft,
          top: faceTop,
          width: faceSize,
          height: faceSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: faceSize * 0.62,
          fontWeight: 800,
          // the printed letter rises when pips sit under it, as in the rig
          paddingBottom: g >= 1 ? PIP_NUDGE * 2 * sy : 0,
          color: upper ? LHAW_INK : INK,
          transform: `rotate(${lean}deg)`,
          transformOrigin: "50% 100%",
        }}
      >
        {glyph}
      </div>

      {/* The glints, over the letter as in the app, and then the stage's pips OVER the glints, as the
          rig paints them (its pips come after its shine): a Mythic word's glint sits on the lower
          face, and drawn the other way round it covered a pip (Bugbot on #247). */}
      {(glints.length > 0 || g >= 1) && (
        <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.W} ${vb.H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <g transform={tilt}>
            {glints}
            {g >= 1 ? [0, 1, 2, 3, 4].map((i) => (i < g ? <path key={`pip-${i}`} d={pipPath(i)} fill={INK} stroke={INK} strokeWidth={2.1} strokeLinejoin="round" /> : <path key={`pip-${i}`} d={pipPath(i)} fill="none" stroke={INK} strokeOpacity={0.26} strokeWidth={1.9} strokeLinejoin="round" />)) : null}
          </g>
        </svg>
      )}
    </div>
  );
}
