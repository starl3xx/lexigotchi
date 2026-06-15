"use client";
/**
 * TileCharacter — the vaudeville rubber-hose tile (design handoff §1–9).
 *
 * A Scrabble-style letter tile come to life: the letter is *printed on the tile* (the face),
 * with pie-eyes perched on the top edge, noodle arms/legs, mitt gloves and bean shoes. No
 * mouth — all expression is eyes + brows + body tilt/bounce. One parameterised component draws
 * every glyph, both cases, all 7 states and all 4 gild stages (never hand-author per-letter art).
 *
 * Cases (the "glow-up"): lowercase = the kid (warm cream wood). UPPERCASE = the grown-up — it
 * literally becomes the blue Let's Have A Word! input tile. Case is derived, never stored.
 *
 * Level-of-detail (spec §9): the printed glyph never degrades; only the limbs simplify at small
 * sizes. `full` = whole character + bounce; `bust` = tile + face, no limbs; `tile` = face only
 * (the dense-grid / word-row form). Auto-selected by size, overridable via `detail`.
 *
 * Motion is pure CSS keyframes (tailwind.config.ts `tc-*`); feet stay planted because the legs
 * group scales-Y while the body group translates-Y, and the shoes never animate. Reduced-motion
 * (spec §7) drops to the static pose carried by eyes + brow + tilt.
 */
import { useEffect, useId, useState, type CSSProperties } from "react";
import { LETTERS_BY_FREQUENCY, scrabbleValue } from "@/lib/economy";

export type TileState = "idle" | "peckish" | "hungry" | "eating" | "rolling" | "upgrade" | "celebrate";
export type TilePose = "rest" | "hero" | "link";
export type TileDetail = "auto" | "full" | "bust" | "tile";
export type Gild = 0 | 1 | 2 | 3 | 4;

export interface TileCharacterProps {
  /** the printed glyph (a–z); case comes from `upper`, not the glyph's own case */
  char: string;
  /** false = lowercase kid (cream wood) · true = UPPERCASE glow-up (LHAW blue) */
  upper?: boolean;
  state?: TileState;
  /** prestige stage 0–4, UPPERCASE only (gilding accrues *around* the tile) */
  gild?: Gild;
  /** Scrabble points (shown lowercase only). Defaults to the letter's standard value. */
  value?: number;
  pose?: TilePose;
  /** rendered width in px */
  size?: number;
  /** level-of-detail override; defaults to auto-by-size */
  detail?: TileDetail;
  /** hand-drawn "boil" displacement on the limbs (off by default — crisp first) */
  boil?: boolean;
  // --- chrome / interaction (parity with the legacy LetterTile so call sites swap cleanly) ---
  count?: number;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Palette (spec §2) — kept local so the SVG has one source of truth.
// ---------------------------------------------------------------------------
const INK = "#2a1e1a"; // outlines, pupils, shoes, lowercase letter
const TILE_FACE = "#f8efdd";
const EDGE_WOOD = "#c7ae84";
const EYE_WHITE = "#ffffff";
const CURTAIN = "#7b1e26";
const BRASS = "#c8962b";
const GOLD = "#f0a617";
const SHEEN = "#fce8a8";
const TWINKLE = "#fff6dd";
const LHAW = "#3b82f6";
const LHAW_RING = "#bbd1fd";
const LHAW_INK = "#111827";
const CONFETTI = ["#d8463f", "#f0a617", "#2a9d8f", "#3b82f6", "#7b1e26"];

// the 6 rarest letters earn a little glint regardless of state
const RAREST = new Set(LETTERS_BY_FREQUENCY.slice(-6));

// ---------------------------------------------------------------------------
// Geometry — everything lives in a 240×340 viewBox (spec §1). Tile = 150×150 @ (45,100).
// ---------------------------------------------------------------------------
const VB = { w: 240, h: 340 };
const T = { x: 45, y: 100, w: 150, h: 150, r: 20 };
const CX = T.x + T.w / 2; // 120
const TOP = T.y; //          100
const BOT = T.y + T.h; //    250
const MID = T.y + T.h / 2; // 175

// ---------------------------------------------------------------------------
// Expression + motion presets, keyed by state.
// ---------------------------------------------------------------------------
type EyeMode = "open" | "happy" | "closed";
type Brow = "raised" | "flat" | "worried" | "sad";
interface Expr {
  eyes: EyeMode;
  lid: number; // fraction of the eye covered by the lid (open states only)
  brow: Brow;
  dart?: boolean; // pupils dart side-to-side
}
const EXPR: Record<TileState, Expr> = {
  idle: { eyes: "open", lid: 0.2, brow: "raised" },
  peckish: { eyes: "open", lid: 0.52, brow: "flat" },
  hungry: { eyes: "closed", lid: 0, brow: "sad" },
  eating: { eyes: "happy", lid: 0, brow: "raised" },
  rolling: { eyes: "open", lid: 0.14, brow: "worried", dart: true },
  upgrade: { eyes: "open", lid: 0.05, brow: "raised" },
  celebrate: { eyes: "happy", lid: 0, brow: "raised" },
};
const BODY_ANIM: Record<TileState, string> = {
  idle: "animate-tc-idle",
  peckish: "animate-tc-bobslow",
  hungry: "",
  eating: "animate-tc-eat",
  rolling: "animate-tc-roll",
  upgrade: "animate-tc-pop",
  celebrate: "animate-tc-jump",
};
const TILT: Record<TileState, number> = {
  idle: 0,
  peckish: -3,
  hungry: -6,
  eating: 0,
  rolling: 0,
  upgrade: 0,
  celebrate: 0,
};

// origin = the element's own bottom, so scale/rotate keep the feet down
const PLANT: CSSProperties = { transformBox: "fill-box", transformOrigin: "center bottom" };

// ---------------------------------------------------------------------------
// prefers-reduced-motion (client-only; SSR-safe default = false)
// ---------------------------------------------------------------------------
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Limb geometry per pose. Arms are noodle quadratics → gloves; legs splay to shoes.
// ---------------------------------------------------------------------------
function arms(pose: TilePose) {
  if (pose === "hero")
    return {
      left: { d: `M ${T.x + 4} ${MID} Q 44 198 64 206`, gx: 64, gy: 206 }, // hand on hip
      right: { d: `M ${T.x + T.w - 4} ${MID} Q 214 150 210 116`, gx: 210, gy: 112 }, // arm waved up
    };
  if (pose === "link")
    return {
      left: { d: `M ${T.x + 4} ${MID + 2} Q 26 182 8 184`, gx: 8, gy: 184 }, // reach out to hold hands
      right: { d: `M ${T.x + T.w - 4} ${MID + 2} Q 214 182 232 184`, gx: 232, gy: 184 },
    };
  return {
    left: { d: `M ${T.x + 4} ${MID} Q 28 206 36 232`, gx: 36, gy: 232 }, // rest — hang down
    right: { d: `M ${T.x + T.w - 4} ${MID} Q 212 206 204 232`, gx: 204, gy: 232 },
  };
}

const FOOT_Y = 300;
const FOOT_LX = CX - 30; // 90
const FOOT_RX = CX + 30; // 150
// rounded bean (local, toe +x), drawn ~0.78× (spec §4)
const SHOE = "M -15 1 Q -21 -19 -1 -21 Q 17 -22 25 -13 Q 33 -5 44 -7 Q 53 -7 53 2 Q 53 4 47 4 L -11 4 Q -15 4 -15 1 Z";

// ===========================================================================
// Eye — open (lidded) / happy (up-arc) / closed (down-arc). Brow drawn separately.
// ===========================================================================
function Eye({
  ex,
  ey,
  r,
  expr,
  look,
  face,
  id,
}: {
  ex: number;
  ey: number;
  r: number;
  expr: Expr;
  look: number; // -1..1 side-glance
  face: string; // eyelid fill (matches the tile face)
  id: string;
}) {
  if (expr.eyes !== "open") {
    const a = r * 0.78;
    const d =
      expr.eyes === "happy"
        ? `M ${ex - a} ${ey + 2} Q ${ex} ${ey - a} ${ex + a} ${ey + 2}` // smiling up-arc
        : `M ${ex - a} ${ey - 2} Q ${ex} ${ey + a} ${ex + a} ${ey - 2}`; // sleepy down-arc
    return <path d={d} stroke={INK} strokeWidth={3.6} fill="none" strokeLinecap="round" />;
  }
  const pr = r * 0.52; // pupil radius
  const px = ex + look * r * 0.4;
  const py = ey + r * 0.34; // sits low
  const lidH = expr.lid * 2 * r; // px covered from the top
  const clip = `tc-eye-${id}`;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <circle cx={ex} cy={ey} r={r} />
        </clipPath>
      </defs>
      <circle cx={ex} cy={ey} r={r} fill={EYE_WHITE} stroke={INK} strokeWidth={3.4} />
      {/* pupil with a pie-slice wedge cut pointing up-right + a glint */}
      <g clipPath={`url(#${clip})`}>
        <circle cx={px} cy={py} r={pr} fill={INK} />
        <path
          d={`M ${px} ${py} L ${px + pr * 1.15} ${py - pr * 0.32} A ${pr * 1.2} ${pr * 1.2} 0 0 0 ${px + pr * 0.55} ${py - pr * 1.1} Z`}
          fill={EYE_WHITE}
        />
        <circle cx={px - pr * 0.4} cy={py - pr * 0.45} r={pr * 0.26} fill={EYE_WHITE} />
        {/* eyelid dropping from the top */}
        {lidH > 0.5 && (
          <>
            <rect x={ex - r} y={ey - r} width={2 * r} height={lidH} fill={face} />
            <line
              x1={ex - r}
              y1={ey - r + lidH}
              x2={ex + r}
              y2={ey - r + lidH}
              stroke={INK}
              strokeWidth={3.2}
            />
          </>
        )}
      </g>
      {/* re-stroke the rim over the lid edge */}
      <circle cx={ex} cy={ey} r={r} fill="none" stroke={INK} strokeWidth={3.4} />
    </g>
  );
}

function browPath(ex: number, y: number, brow: Brow, side: -1 | 1): string {
  const inner = ex + side * 9; // toward the nose
  const outer = ex - side * 9;
  switch (brow) {
    case "flat":
      return `M ${outer} ${y} L ${inner} ${y}`;
    case "worried":
      return `M ${outer} ${y + 3} L ${inner} ${y - 2}`; // inner up, outer down
    case "sad":
      return `M ${outer} ${y + 4} L ${inner} ${y - 3}`;
    default:
      return `M ${outer} ${y + 2} Q ${ex} ${y - 4} ${inner} ${y + 2}`; // raised arc
  }
}

// ===========================================================================
// Gild layers (UPPERCASE only, spec §6) — pips + brass ring + sheen + twinkles + crown.
// ===========================================================================
function diamond(cx: number, cy: number, s = 3.8) {
  return `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;
}
function star4(cx: number, cy: number, R = 7, r = 2.6) {
  const p: string[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    p.push(`${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`);
  }
  return `M ${p.join(" L ")} Z`;
}

// Border / ring widths — thick, contiguous frame (design review: no gaps, beefier lines).
const BORDER_UP = 12; // UPPERCASE blue tile border
const RING_PB = 10; // pale-blue LHAW outer ring
const BRASS_W = [0, 8, 10, 12, 12]; // gild main brass ring by stage
const SHEEN_W = 5; // pale-gold sheen
const BRASS2_W = 5; // gild-4 second ring

/** Rings stacked OUTSIDE the blue tile border, each abutting the last (no gaps).
 *  gild 0 = the pale-blue LHAW skin; once gilded, GOLD REPLACES that outer blue ring
 *  (design review — stacking both reads too thick). */
function ringSpecs(gild: Gild): { w: number; color: string }[] {
  if (gild <= 0) return [{ w: RING_PB, color: LHAW_RING }];
  const out = [
    { w: BRASS_W[gild], color: BRASS },
    { w: SHEEN_W, color: SHEEN },
  ];
  if (gild >= 4) out.push({ w: BRASS2_W, color: BRASS });
  return out;
}
/** Outer extent of the ring stack beyond the tile edge (for twinkle placement). */
function ringOuter(gild: Gild): number {
  return ringSpecs(gild).reduce((e, r) => e + r.w, BORDER_UP / 2);
}

/** The pale-blue LHAW skin + any gild brass/sheen rings — drawn back-to-front, contiguous. */
function Rings({ gild }: { gild: Gild }) {
  let edge = BORDER_UP / 2; // start at the outer face of the blue tile border
  return (
    <>
      {ringSpecs(gild).map((r, i) => {
        const off = edge + r.w / 2;
        edge += r.w;
        return (
          <rect
            key={i}
            x={T.x - off}
            y={T.y - off}
            width={T.w + 2 * off}
            height={T.h + 2 * off}
            rx={T.r + off}
            fill="none"
            stroke={r.color}
            strokeWidth={r.w}
          />
        );
      })}
    </>
  );
}

function Twinkles({ gild, reduced }: { gild: Gild; reduced: boolean }) {
  if (gild <= 0) return null;
  const ro = ringOuter(gild);
  const items = [
    { x: T.x + T.w + ro - 4, y: T.y - ro + 10, show: true, d: 0 },
    { x: T.x - ro + 4, y: MID + 14, show: gild >= 2, d: 0.5 },
    { x: CX + 34, y: T.y - ro - 2, show: gild >= 4, d: 1 },
  ];
  return (
    <>
      {items
        .filter((t) => t.show)
        .map((t, i) => (
          <path
            key={i}
            d={star4(t.x, t.y, 9, 3)}
            fill={TWINKLE}
            stroke={GOLD}
            strokeWidth={1}
            className={reduced ? "" : "animate-tc-twinkle"}
            style={reduced ? undefined : ({ animationDelay: `${t.d}s`, ...PLANT } as CSSProperties)}
          />
        ))}
    </>
  );
}

function Pips({ gild }: { gild: Gild }) {
  if (gild <= 0) return null;
  const y = BOT - 22;
  return (
    <g>
      {[0, 1, 2, 3].map((i) => {
        const cx = CX + (i - 1.5) * 24;
        const filled = i < gild;
        return (
          <path
            key={i}
            d={diamond(cx, y, 7)}
            fill={filled ? GOLD : "#ffffff"}
            stroke={filled ? INK : "#c9cfd8"}
            strokeWidth={2}
          />
        );
      })}
    </g>
  );
}

function Crown({ base }: { base: number }) {
  // 3-point gold crown sitting on the OUTER border edge (passed in), drawn inside the body
  // group so it bounces with the tile. Sits centred between the two eyes.
  const peak = base - 24;
  const mid = base - 9;
  const hw = 18;
  return (
    <g>
      <path
        d={`M ${CX - hw} ${base} L ${CX - hw} ${base - 11} L ${CX - hw * 0.5} ${mid} L ${CX} ${peak} L ${CX + hw * 0.5} ${mid} L ${CX + hw} ${base - 11} L ${CX + hw} ${base} Z`}
        fill={GOLD}
        stroke={INK}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      <circle cx={CX} cy={base - 7} r={2.6} fill={CURTAIN} />
      <circle cx={CX - 10} cy={base - 5} r={2} fill={CURTAIN} />
      <circle cx={CX + 10} cy={base - 5} r={2} fill={CURTAIN} />
    </g>
  );
}

// ===========================================================================
// State extras (zzz / ? / snack / burst rays / confetti).
// ===========================================================================
function BurstRays({ reduced }: { reduced: boolean }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (Math.PI / 6) * i;
    const r1 = 70;
    const r2 = 120;
    const wsp = 0.16;
    const p = `M ${CX + r1 * Math.cos(a - wsp)} ${MID + r1 * Math.sin(a - wsp)} L ${CX + r2 * Math.cos(a)} ${MID + r2 * Math.sin(a)} L ${CX + r1 * Math.cos(a + wsp)} ${MID + r1 * Math.sin(a + wsp)} Z`;
    return <path key={i} d={p} fill={GOLD} />;
  });
  return (
    <g
      className={reduced ? "" : "animate-tc-ray"}
      style={reduced ? undefined : ({ transformBox: "fill-box", transformOrigin: "center", opacity: 0.55 } as CSSProperties)}
      opacity={0.55}
    >
      {rays}
    </g>
  );
}

function Confetti({ reduced }: { reduced: boolean }) {
  return (
    <g>
      {Array.from({ length: 16 }, (_, i) => {
        const x = 24 + (i * 197) % (VB.w - 48);
        const c = CONFETTI[i % CONFETTI.length];
        const delay = (i % 8) * 0.18;
        const startY = TOP - 18;
        return (
          <rect
            key={i}
            x={x}
            y={reduced ? startY + ((i * 53) % 120) : startY}
            width={6}
            height={9}
            rx={1.5}
            fill={c}
            opacity={reduced ? 1 : undefined}
            className={reduced ? "" : "animate-tc-confetti"}
            style={reduced ? undefined : { animationDelay: `${delay}s` }}
          />
        );
      })}
    </g>
  );
}

function Zzz({ reduced }: { reduced: boolean }) {
  const zs = [
    { x: T.x + T.w + 4, y: TOP + 6, s: 14 },
    { x: T.x + T.w + 16, y: TOP - 8, s: 18 },
    { x: T.x + T.w + 30, y: TOP - 24, s: 22 },
  ];
  return (
    <g fill={INK} fontFamily="var(--font-body)" fontWeight={800}>
      {zs.map((z, i) => (
        <text
          key={i}
          x={z.x}
          y={z.y}
          fontSize={z.s}
          className={reduced ? "" : "animate-tc-zzz"}
          style={reduced ? undefined : { animationDelay: `${i * 0.5}s` }}
        >
          z
        </text>
      ))}
    </g>
  );
}

function Huh({ reduced }: { reduced: boolean }) {
  return (
    <text
      x={CX}
      y={TOP - 14}
      textAnchor="middle"
      fontFamily="var(--font-body)"
      fontWeight={800}
      fontSize={34}
      fill={CURTAIN}
      className={reduced ? "" : "animate-tc-bobslow"}
      style={PLANT}
    >
      ?
    </text>
  );
}

function Snack() {
  // a cookie where a mouth would be (no mouth — it's being fed), with chips + crumbs
  const x = CX;
  const y = BOT - 26;
  return (
    <g>
      <circle cx={x} cy={y} r={12} fill={CURTAIN} stroke={INK} strokeWidth={2.2} />
      <circle cx={x - 4} cy={y - 3} r={1.7} fill={INK} />
      <circle cx={x + 4} cy={y + 2} r={1.7} fill={INK} />
      <circle cx={x + 1} cy={y - 5} r={1.4} fill={INK} />
      <circle cx={x - 18} cy={y + 8} r={1.6} fill={CURTAIN} />
      <circle cx={x + 17} cy={y + 10} r={2} fill={CURTAIN} />
    </g>
  );
}

// ===========================================================================
// Main component
// ===========================================================================
export function TileCharacter({
  char,
  upper = false,
  state = "idle",
  gild = 0,
  value,
  pose = "rest",
  size = 120,
  detail = "auto",
  boil = false,
  count,
  selected = false,
  dim = false,
  onClick,
  title,
  className = "",
  style,
}: TileCharacterProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, ""); // unique, SVG-id-safe (avoids clip/filter id collisions)

  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  const expr = EXPR[state];
  const tilt = TILT[state];
  const g: Gild = upper ? gild : 0; // gild is UPPERCASE-only

  // level of detail by rendered size (spec §9) — limbs simplify, glyph never degrades
  const lod: Exclude<TileDetail, "auto"> =
    detail !== "auto" ? detail : size >= 100 ? "full" : size >= 60 ? "bust" : "tile";
  const showLimbs = lod === "full";
  const showFace = lod !== "tile";
  // each LOD crops to what it draws, so the rendered box stays tight (no empty limb space in grids)
  const VIEW =
    lod === "full"
      ? { x: 0, y: 0, w: VB.w, h: VB.h }
      : lod === "bust"
        ? { x: 30, y: 62, w: 180, h: 200 }
        : { x: 30, y: 86, w: 180, h: 180 };

  // face colors per case
  const faceFill = upper ? "#ffffff" : TILE_FACE;
  const border = upper ? LHAW : INK;
  const borderW = upper ? BORDER_UP : 4;
  const letterFill = upper ? LHAW_INK : INK;
  const letterFont = "var(--font-body)"; // Söhne bold for both cases (design review)
  const letterWeight = 800;

  const eyeR = upper ? 21 : 20;
  // Gilded tiles have a thicker top border — perch the eyes on its OUTER edge so they ride up
  // and stay near the top as the gild ring grows (design review). Lowercase keeps the base spot.
  const eyeY = upper ? TOP + eyeR - 1 - ringOuter(g) : TOP + 4;
  // when pips are present, nudge the printed letter up so the two never collide
  const letterY = MID + 4 - (g >= 1 ? 12 : 0);
  const face = arms(pose);
  const seed = char.toUpperCase().charCodeAt(0);
  const boilFilter = boil && showLimbs ? `url(#tc-boil-${uid})` : undefined;

  const renderH = Math.round(size * (VIEW.h / VIEW.w));
  const bodyAnim = reduced ? "" : BODY_ANIM[state];
  const legAnim = reduced || state !== "idle" ? "" : "animate-tc-legbob";

  const Glove = ({ gx, gy }: { gx: number; gy: number }) => (
    <g filter={boilFilter}>
      <circle cx={gx + 4} cy={gy + 4} r={6.5} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <circle cx={gx} cy={gy} r={13} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
    </g>
  );

  const svg = (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      width={size}
      height={renderH}
      className="overflow-visible"
      style={{ display: "block" }}
    >
      {boil && showLimbs && (
        <defs>
          <filter id={`tc-boil-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={2} seed={seed} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      )}

      {/* gold burst rays (upgrade) — behind everything */}
      {state === "upgrade" && <BurstRays reduced={reduced} />}

      {/* ground shadow — static, anchors the figure */}
      {showLimbs && <ellipse cx={CX} cy={FOOT_Y + 16} rx={66} ry={9} fill={INK} opacity={0.16} />}

      {/* shoes — planted, never animate */}
      {showLimbs && (
        <g fill={INK} filter={boilFilter}>
          <path d={SHOE} transform={`translate(${FOOT_LX} ${FOOT_Y}) scale(-0.78 0.78)`} />
          <path d={SHOE} transform={`translate(${FOOT_RX} ${FOOT_Y}) scale(0.78 0.78)`} />
        </g>
      )}

      {/* figure: static tilt wrapper (SVG attr) so it composes with the CSS bounce inside */}
      <g transform={tilt ? `rotate(${tilt} ${CX} ${BOT})` : undefined}>
        {/* legs — scaleY bounce from the feet */}
        {showLimbs && (
          <g className={legAnim} style={PLANT} filter={boilFilter}>
            <path d={`M ${CX - 24} ${BOT - 8} Q ${CX - 36} 275 ${FOOT_LX} ${FOOT_Y - 6}`} stroke={INK} strokeWidth={9} fill="none" strokeLinecap="round" />
            <path d={`M ${CX + 24} ${BOT - 8} Q ${CX + 36} 275 ${FOOT_RX} ${FOOT_Y - 6}`} stroke={INK} strokeWidth={9} fill="none" strokeLinecap="round" />
          </g>
        )}

        {/* body group — tile + face + arms + gloves translate up together */}
        <g className={bodyAnim} style={PLANT}>
          {/* arms behind the tile */}
          {showLimbs && (
            <g filter={boilFilter}>
              <path d={face.left.d} stroke={INK} strokeWidth={9} fill="none" strokeLinecap="round" />
              <path d={face.right.d} stroke={INK} strokeWidth={9} fill="none" strokeLinecap="round" />
            </g>
          )}

          {/* UPPERCASE ring stack — pale-blue LHAW skin + any gild brass/sheen, all contiguous */}
          {upper && <Rings gild={g} />}

          {/* lowercase 3-D bottom edge (the wooden shelf) */}
          {!upper && <rect x={T.x} y={T.y + 7} width={T.w} height={T.h} rx={T.r} fill={EDGE_WOOD} />}

          {/* tile face */}
          <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={faceFill} stroke={border} strokeWidth={borderW} />

          {/* the printed glyph — real text, razor-sharp at any size (spec §9) */}
          <text
            x={CX}
            y={letterY}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={letterFont}
            fontWeight={letterWeight}
            fontSize={92}
            fill={letterFill}
          >
            {glyph}
          </text>

          {/* crown topper (gild 4) — sits on the OUTER border edge; bounces with the body group */}
          {g >= 4 && <Crown base={TOP - ringOuter(g)} />}

          {/* gild pips on the lower face */}
          <Pips gild={g} />

          {/* point value — lowercase only, bottom-right; hidden in dense (tile) LOD so it
              never collides with the inventory count bubble */}
          {!upper && lod !== "tile" && (
            <text
              x={T.x + T.w - 14}
              y={BOT - 13}
              textAnchor="end"
              fontFamily="var(--font-body)"
              fontWeight={800}
              fontSize={20}
              fill={INK}
            >
              {value ?? scrabbleValue(char)}
            </text>
          )}

          {/* gloves on top of the tile edges */}
          {showLimbs && (
            <>
              <Glove gx={face.left.gx} gy={face.left.gy} />
              <Glove gx={face.right.gx} gy={face.right.gy} />
            </>
          )}

          {/* eyes + brows perched on the top edge */}
          {showFace && (
            <g>
              {expr.eyes === "open" && (
                <g className={expr.dart && !reduced ? "animate-tc-dart" : ""}>
                  <Eye ex={CX - 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={faceFill} id={`${uid}l`} />
                  <Eye ex={CX + 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={faceFill} id={`${uid}r`} />
                </g>
              )}
              {expr.eyes !== "open" && (
                <>
                  <Eye ex={CX - 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={faceFill} id={`${uid}l`} />
                  <Eye ex={CX + 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={faceFill} id={`${uid}r`} />
                </>
              )}
              <path d={browPath(CX - 26, eyeY - eyeR - 4, expr.brow, 1)} stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
              <path d={browPath(CX + 26, eyeY - eyeR - 4, expr.brow, -1)} stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
            </g>
          )}

          {/* rare-letter glint */}
          {showFace && RAREST.has(char.toUpperCase()) && g === 0 && (
            <path d={star4(T.x + T.w - 6, T.y + 6, 6, 2.2)} fill={GOLD} stroke={INK} strokeWidth={0.8} className={reduced ? "" : "animate-tc-twinkle"} style={PLANT} />
          )}

          {/* gild twinkles — riding the rings */}
          <Twinkles gild={g} reduced={reduced} />
        </g>
      </g>

      {/* per-state extras anchored to the scene */}
      {showFace && state === "hungry" && <Zzz reduced={reduced} />}
      {showFace && state === "rolling" && <Huh reduced={reduced} />}
      {showFace && state === "eating" && <Snack />}
      {state === "celebrate" && <Confetti reduced={reduced} />}
    </svg>
  );

  const label = `${glyph} tile${upper ? " (UPPERCASE)" : ""} — ${state}${g ? ` · gilded ${g}` : ""}`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`relative inline-flex items-center justify-center transition-transform ${
        selected ? "-translate-y-1" : ""
      } ${dim ? "opacity-35" : ""} ${onClick ? "active:translate-y-0.5" : ""} ${className}`}
      style={{ width: size, ...style }}
    >
      {svg}
      {count !== undefined && count > 1 && (
        <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink bg-paper px-1 text-[11px] font-bold">
          {count}
        </span>
      )}
      {selected && (
        <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-candy ring-offset-1 ring-offset-paper" />
      )}
    </Tag>
  );
}

// ===========================================================================
// TileWord — a 5-letter word as a row of TileCharacters "holding hands" (the link pose).
// Tiles overlap so neighbouring gloves meet; choreography staggers the bounce.
// ===========================================================================
export function TileWord({
  word,
  upper,
  state = "idle",
  gild = 0,
  size = 64,
  detail = "auto",
  className = "",
}: {
  word: string;
  upper: boolean[];
  state?: TileState;
  gild?: Gild;
  size?: number;
  detail?: TileDetail;
  className?: string;
}) {
  const letters = [...word];
  // full-size words show characters "holding hands" (link pose, arms overlap); smaller word
  // rows have no limbs, so they sit in a neat row with a small positive gap instead.
  const full = detail === "full" || (detail === "auto" && size >= 100);
  return (
    <div
      className={`flex items-end justify-center ${className}`}
      style={full ? undefined : { gap: Math.max(2, Math.round(size * 0.08)) }}
    >
      {letters.map((ch, i) => (
        <div key={i} style={full ? { marginLeft: i ? -size * 0.14 : 0 } : undefined}>
          <TileCharacter
            char={ch}
            upper={upper[i] ?? false}
            state={state}
            gild={gild}
            pose={full ? "link" : "rest"}
            size={size}
            detail={detail}
          />
        </div>
      ))}
    </div>
  );
}
