import type { ReactElement } from "react";
import type { Tier } from "@/lib/economy";
import { finishFor, type Finish } from "@/lib/rarityFinish";
import { facets, glintFlare, SCROLL_MIRRORS, SCROLL_PATH } from "@/components/game/TileFinish";

/**
 * A static vaudeville tile character built for Satori (next/og). The real rig (`TileCharacter`)
 * is a "use client" SVG component with `<text>`, filters and CSS animation, none of which Satori
 * renders, so this is a purpose-built, idle, Satori-safe twin: inline SVG *shapes* for the tile +
 * eyes + noodle limbs + bean shoes, with the printed letter overlaid as Söhne `<div>` text (the
 * only way to get real glyphs into an ImageResponse). Geometry mirrors the rig's 240×340 /
 * 150-tile layout so it reads as the same character.
 *
 * The word's rarity is drawn as the app draws a still finish (components/game/TileFinish, motion
 * "off"): the aura behind the tile, the material over the face, the border again, the letter,
 * then the glints over it, in a second svg above the letter. Satori's rules hold here as in the
 * scenes (scenes/kit.tsx): only plain SVG elements, built by functions, never a component or a
 * fragment inside an `<svg>`, and no attribute left undefined.
 */

const INK = "#2a1e1a";
const TILE_FACE = "#f8efdd";
const EDGE_WOOD = "#c7ae84";
const LHAW = "#3b82f6";
const LHAW_RING = "#bbd1fd";
const LHAW_INK = "#111827";
const EYE_WHITE = "#ffffff";

const SHOE =
  "M -15 1 Q -21 -19 -1 -21 Q 17 -22 25 -13 Q 33 -5 44 -7 Q 53 -7 53 2 Q 53 4 47 4 L -11 4 Q -15 4 -15 1 Z";

// the rig's geometry (TileCharacter, TileFinish: the tile 150×150 at 45,100)
const T = { x: 45, y: 100, w: 150, h: 150, r: 20 };
const CX = T.x + T.w / 2;
const MID = T.y + T.h / 2;
const BOT = T.y + T.h;

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

export function OgTile({
  char,
  upper = false,
  w = 200,
  limbs = true,
  tier,
  index = 0,
  uid = "t",
}: {
  char: string;
  upper?: boolean;
  w?: number;
  limbs?: boolean;
  /** The word's rarity, worn as the tile's material (lib/rarityFinish), as a still. */
  tier?: Tier;
  /** The tile's place in its word: the glints alternate along a word, as in the app. */
  index?: number;
  /** Keeps this tile's gradient and clip ids apart from its neighbours'. */
  uid?: string;
}): ReactElement {
  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  // crop: full character (with limbs) vs a tight tile+head box (icon)
  const vb = limbs ? { x: 0, y: 0, W: 240, H: 340 } : { x: 18, y: 70, W: 204, H: 204 };
  const h = Math.round((w * vb.H) / vb.W);
  const sx = w / vb.W;
  const sy = h / vb.H;

  // letter overlay placed exactly over the tile face (45,100,150,150 in viewBox space)
  const faceLeft = (45 - vb.x) * sx;
  const faceTop = (100 - vb.y) * sy;
  const faceSize = 150 * sx;
  const eyeR = upper ? 21 : 20;
  const fin = finishFor(tier);
  const bw = upper ? 12 : 4; // the face's border
  const u = (n: string) => `rf-${n}-${uid}`;
  const border = (
    <rect x="45" y="100" width="150" height="150" rx="20" fill="none" stroke={upper ? LHAW : INK} strokeWidth={bw} />
  );
  const glints = fin ? finishGlints(fin, index) : [];

  return (
    <div style={{ position: "relative", display: "flex", width: w, height: h }}>
      <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.W} ${vb.H}`} style={{ position: "absolute", left: 0, top: 0 }}>
        {fin && finishDefs(fin, u, bw)}
        {limbs && (
          <g>
            <ellipse cx="120" cy="302" rx="86" ry="12" fill={INK} opacity="0.17" />
            <path d={SHOE} transform="translate(90 300) scale(-0.78 0.78)" fill={INK} />
            <path d={SHOE} transform="translate(150 300) scale(0.78 0.78)" fill={INK} />
            <path d="M 96 242 Q 84 275 90 294" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M 144 242 Q 156 275 150 294" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            {/* arms (behind the tile — gloves are drawn in front, after the face) */}
            <path d="M 49 175 Q 28 206 36 232" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M 191 175 Q 212 206 204 232" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
          </g>
        )}

        {/* the rarity's aura, behind the tile */}
        {fin && finishAura(fin, u)}

        {/* tile face + case skin */}
        {upper ? (
          <rect x="34" y="89" width="172" height="172" rx="31" fill="none" stroke={LHAW_RING} strokeWidth="10" />
        ) : (
          <rect x="45" y="107" width="150" height="150" rx="20" fill={EDGE_WOOD} />
        )}
        <rect x="45" y="100" width="150" height="150" rx="20" fill={upper ? "#ffffff" : TILE_FACE} stroke={upper ? LHAW : INK} strokeWidth={bw} />
        {/* the rarity's material over the face, then the border again over its edge */}
        {fin && finishSurface(fin, u, bw)}
        {fin && border}

        {/* mitt gloves — in front of the tile face (matches the rig) */}
        {limbs && (
          <g>
            <circle cx="40" cy="236" r="6.5" fill={EYE_WHITE} stroke={INK} strokeWidth="2.6" />
            <circle cx="36" cy="232" r="13" fill={EYE_WHITE} stroke={INK} strokeWidth="2.8" />
            <circle cx="208" cy="236" r="6.5" fill={EYE_WHITE} stroke={INK} strokeWidth="2.6" />
            <circle cx="204" cy="232" r="13" fill={EYE_WHITE} stroke={INK} strokeWidth="2.8" />
          </g>
        )}

        {/* pie-eyes on the top edge */}
        <circle cx="94" cy="104" r={eyeR} fill={EYE_WHITE} stroke={INK} strokeWidth="3.4" />
        <circle cx="146" cy="104" r={eyeR} fill={EYE_WHITE} stroke={INK} strokeWidth="3.4" />
        <circle cx="94" cy="111" r={eyeR * 0.52} fill={INK} />
        <circle cx="146" cy="111" r={eyeR * 0.52} fill={INK} />
        <circle cx="90" cy="101" r="2.8" fill={EYE_WHITE} />
        <circle cx="142" cy="101" r="2.8" fill={EYE_WHITE} />
        {/* raised brows */}
        <path d="M 85 81 Q 94 75 103 81" stroke={INK} strokeWidth="4.6" fill="none" strokeLinecap="round" />
        <path d="M 137 81 Q 146 75 155 81" stroke={INK} strokeWidth="4.6" fill="none" strokeLinecap="round" />
      </svg>

      {/* the printed letter — Söhne via Satori text, centred on the tile face */}
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
          color: upper ? LHAW_INK : INK,
        }}
      >
        {glyph}
      </div>

      {/* the glints, over the letter as in the app */}
      {glints.length > 0 && (
        <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.W} ${vb.H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          {glints}
        </svg>
      )}
    </div>
  );
}
