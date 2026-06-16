import type { ReactElement } from "react";

/**
 * A static vaudeville tile character built for Satori (next/og). The real rig (`TileCharacter`)
 * is a "use client" SVG component with `<text>`, clipPaths, filters and CSS animation — none of
 * which Satori renders — so this is a purpose-built, idle, Satori-safe twin: inline SVG *shapes*
 * for the tile + eyes + noodle limbs + bean shoes, with the printed letter overlaid as Söhne
 * `<div>` text (the only way to get real glyphs into an ImageResponse). Geometry mirrors the rig's
 * 240×340 / 150-tile layout so it reads as the same character.
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

export function OgTile({
  char,
  upper = false,
  w = 200,
  limbs = true,
}: {
  char: string;
  upper?: boolean;
  w?: number;
  limbs?: boolean;
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

  return (
    <div style={{ position: "relative", display: "flex", width: w, height: h }}>
      <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.W} ${vb.H}`} style={{ position: "absolute", left: 0, top: 0 }}>
        {limbs && (
          <g>
            <ellipse cx="120" cy="296" rx="86" ry="12" fill={INK} opacity="0.17" />
            <path d={SHOE} transform="translate(90 300) scale(-0.78 0.78)" fill={INK} />
            <path d={SHOE} transform="translate(150 300) scale(0.78 0.78)" fill={INK} />
            <path d="M 96 242 Q 84 275 90 294" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M 144 242 Q 156 275 150 294" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            {/* arms (behind the tile — gloves are drawn in front, after the face) */}
            <path d="M 49 175 Q 28 206 36 232" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M 191 175 Q 212 206 204 232" stroke={INK} strokeWidth="9" fill="none" strokeLinecap="round" />
          </g>
        )}

        {/* tile face + case skin */}
        {upper ? (
          <rect x="34" y="89" width="172" height="172" rx="31" fill="none" stroke={LHAW_RING} strokeWidth="10" />
        ) : (
          <rect x="45" y="107" width="150" height="150" rx="20" fill={EDGE_WOOD} />
        )}
        <rect
          x="45"
          y="100"
          width="150"
          height="150"
          rx="20"
          fill={upper ? "#ffffff" : TILE_FACE}
          stroke={upper ? LHAW : INK}
          strokeWidth={upper ? 12 : 4}
        />

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
    </div>
  );
}
