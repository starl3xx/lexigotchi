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
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { LETTERS_BY_FREQUENCY, scrabbleValue, type Tier } from "@/lib/economy";
import { finishFor, mixHex } from "@/lib/rarityFinish";
import { FinishAura, FinishDefs, FinishLight, FinishMotes, FinishShine, FinishSurface, Glint, MOMENT_END_S, type FinishMotion } from "./TileFinish";

export type TileState = "idle" | "peckish" | "hungry" | "eating" | "rolling" | "upgrade" | "celebrate";
export type TilePose = "rest" | "hero" | "link";
export type TileDetail = "auto" | "full" | "bust" | "tile";
/** Ascension stage, UPPERCASE only: 0 plain, 1–4 Gilded, 5 Holographic (the word ladder, decisions.md #19). */
export type Gild = 0 | 1 | 2 | 3 | 4 | 5;

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
  /**
   * Fill the parent's width instead of `size` px (the height follows the drawing's shape). For a
   * layout in percentages that must draw before anything is measured: a word standing in its scene
   * (scenes/SceneFrame), which a share page renders on the server. `size` still picks the detail.
   */
  fluid?: boolean;
  /** The rarity of the word this letter is part of, worn as the tile's material (lib/rarityFinish,
   *  ./TileFinish). Loose letters have none. */
  tier?: Tier;
  /** A still frame: the character and its finish hold still (a still scene, a card in a grid, a thumbnail). */
  still?: boolean;
  /** The letter's place in its word, so the finish's light passes along the word in turn. */
  index?: number;
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
// Holographic (stage 5): an iridescent foil in place of the gold, the stage-4 look reborn. One
// gradient per tile (id from useId), drifting slowly unless the viewer prefers reduced motion.
const HOLO_STOPS: [number, string][] = [
  [0, "#ff9ad5"],
  [0.25, "#ffe28a"],
  [0.5, "#8ff0d0"],
  [0.75, "#8ec5ff"],
  [1, "#c7a0ff"],
];
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

/**
 * A device that should get the still finishes: a low-end phone (2 GB of memory or less, which only
 * Chromium reports) or Save-Data on. Read once (it can't change mid-session) and SSR-safe (false
 * until mounted). Not the core count: WebKit reports at most 2 on iOS (a fingerprinting guard), so
 * it would keep every iPhone still, the mini app's hosts included. The finishes' motion is cheap by
 * design instead: a moment every few seconds, only for the word in focus (useFinishMoment).
 */
let lowPowerCache: boolean | null = null;
function readLowPower(): boolean {
  if (lowPowerCache !== null) return lowPowerCache;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  lowPowerCache = (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) || nav.connection?.saveData === true;
  return lowPowerCache;
}
export function useLowPower(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => setLow(readLowPower()), []);
  return low;
}

/**
 * Whether the element is on screen (within 80 px), while `watch` is on; true until the first
 * answer. An element hidden by `display: none` reads as off screen.
 */
export function useOnScreen(ref: RefObject<Element | null>, watch: boolean): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!watch || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, watch]);
  return on;
}

/** How long a word's row carries .rf-moment: until its last effect ends (TileFinish's MOMENT_END_S), and a little more. */
const MOMENT_MS = Math.ceil(MOMENT_END_S * 1000) + 100;
/**
 * A finished word's moments (globals.css, .rf-moment; ./TileFinish): the first soon after it
 * appears, then one every `period` seconds of its tier, and one whenever `play()` is called (the
 * pointer coming onto the word). One timer per word, never per tile; none at all while `active` is
 * false (off screen, a still scene, reduced motion, a slow device, no finish). Returns whether a
 * moment is playing, and `play`.
 *
 * `word` ties a moment to its word: when the host shows another word (the Today stage's arrows), a
 * moment begun on the last one isn't the new word's, so the new tiles start without it and get a
 * fresh first moment, rather than inheriting a class whose timer would end their pass mid-way.
 */
export function useFinishMoment(tier: Tier | undefined, active: boolean, word = ""): [boolean, () => void] {
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  const period = finishFor(tier)?.period;
  const on = active && !!period && !reduced && !lowPower;
  // the word whose moment is playing, or null
  const [playing, setPlaying] = useState<string | null>(null);
  const busy = useRef(false);
  const ends = useRef<number | undefined>(undefined);
  const play = useCallback(() => {
    if (!on || busy.current) return;
    busy.current = true;
    setPlaying(word);
    ends.current = window.setTimeout(() => {
      busy.current = false;
      setPlaying(null);
    }, MOMENT_MS);
  }, [on, word]);
  useEffect(() => {
    if (!on || !period) return;
    let next = window.setTimeout(function tick() {
      play();
      next = window.setTimeout(tick, period * 1000);
    }, 1200);
    return () => {
      window.clearTimeout(next);
      window.clearTimeout(ends.current);
      busy.current = false;
      setPlaying(null);
    };
  }, [on, period, play]);
  return [playing === word && on, play];
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
const BRASS_W = [0, 8, 10, 12, 12, 12]; // gild main ring by stage (Holographic keeps stage 4's weight)
const SHEEN_W = 5; // pale-gold sheen
const BRASS2_W = 5; // gild-4 second ring

/** Rings stacked OUTSIDE the blue tile border, each abutting the last (no gaps).
 *  gild 0 = the pale-blue LHAW skin; once gilded, GOLD REPLACES that outer blue ring
 *  (design review — stacking both reads too thick). Holographic paints the gold rings with the
 *  foil (`holo`, a gradient url) and turns the sheen white so the colors read. */
function ringSpecs(gild: Gild, holo?: string): { w: number; color: string }[] {
  if (gild <= 0) return [{ w: RING_PB, color: LHAW_RING }];
  const metal = gild >= 5 && holo ? holo : BRASS;
  const out = [
    { w: BRASS_W[gild], color: metal },
    { w: SHEEN_W, color: gild >= 5 ? EYE_WHITE : SHEEN },
  ];
  if (gild >= 4) out.push({ w: BRASS2_W, color: metal });
  return out;
}
/** Outer extent of the ring stack beyond the tile edge (for twinkle placement). */
function ringOuter(gild: Gild): number {
  return ringSpecs(gild).reduce((e, r) => e + r.w, BORDER_UP / 2);
}

/** The pale-blue LHAW skin + any gild brass/sheen rings — drawn back-to-front, contiguous. */
function Rings({ gild, holo }: { gild: Gild; holo?: string }) {
  let edge = BORDER_UP / 2; // start at the outer face of the blue tile border
  return (
    <>
      {ringSpecs(gild, holo).map((r, i) => {
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

function Twinkles({ gild, reduced, holo, soft }: { gild: Gild; reduced: boolean; holo?: string; soft?: string }) {
  if (gild <= 0) return null;
  const ro = ringOuter(gild);
  const items = [
    { x: T.x + T.w + ro - 4, y: T.y - ro + 10, show: true, d: 0 },
    { x: T.x - ro + 4, y: MID + 14, show: gild >= 2, d: 0.5 },
    { x: CX + 34, y: T.y - ro - 2, show: gild >= 4, d: 1 },
  ];
  // on a finished tile (below Holographic), the same twinkles as soft glints with no outline
  if (soft && gild < 5)
    return (
      <>
        {items
          .filter((t) => t.show)
          .map((t, i) => (
            <Glint key={i} x={t.x} y={t.y} s={0.7} color={soft} delay={0} anim={false} />
          ))}
      </>
    );
  return (
    <>
      {items
        .filter((t) => t.show)
        .map((t, i) => (
          <path
            key={i}
            d={star4(t.x, t.y, 9, 3)}
            fill={TWINKLE}
            stroke={gild >= 5 && holo ? holo : GOLD}
            strokeWidth={gild >= 5 ? 2 : 1}
            className={reduced ? "" : "animate-tc-twinkle"}
            style={reduced ? undefined : ({ animationDelay: `${t.d}s`, ...PLANT } as CSSProperties)}
          />
        ))}
    </>
  );
}

/** One pip per stage of the word ladder: four gold, then the Holographic one in foil. */
function Pips({ gild, holo, plate = false }: { gild: Gild; holo?: string; plate?: boolean }) {
  if (gild <= 0) return null;
  const y = BOT - 22;
  return (
    <g>
      {/* on a rarity face (gold, say), the pips sit on a white plate, or the gold ones
          (earned) vanish into the face while the white ones (still to come) stand out */}
      {plate && <rect x={CX - 60} y={y - 12} width={120} height={24} rx={12} fill="#ffffff" stroke={INK} strokeWidth={2} />}
      {[0, 1, 2, 3, 4].map((i) => {
        const cx = CX + (i - 2) * 22;
        const filled = i < gild;
        const paint = i === 4 && holo ? holo : GOLD;
        return (
          <path
            key={i}
            d={diamond(cx, y, 7)}
            fill={filled ? paint : "#ffffff"}
            stroke={filled ? INK : "#c9cfd8"}
            strokeWidth={2}
          />
        );
      })}
    </g>
  );
}

function Crown({ base, paint = GOLD }: { base: number; paint?: string }) {
  // 3-point gold crown sitting on the OUTER border edge (passed in), drawn inside the body
  // group so it bounces with the tile. Sits centred between the two eyes.
  const peak = base - 24;
  const mid = base - 9;
  const hw = 18;
  return (
    <g>
      <path
        d={`M ${CX - hw} ${base} L ${CX - hw} ${base - 11} L ${CX - hw * 0.5} ${mid} L ${CX} ${peak} L ${CX + hw * 0.5} ${mid} L ${CX + hw} ${base - 11} L ${CX + hw} ${base} Z`}
        fill={paint}
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

/**
 * Confetti for the celebrate state: 16 pieces that fall and tumble INSIDE the tile's own visible
 * box (the LOD crop, which is always centered on the tile), so a word row celebrates tile by tile
 * instead of spraying across its neighbors and the text above.
 *
 * Each piece spins around ITS OWN center (`transform-box: fill-box`). Without that, a CSS rotate on
 * an SVG element turns around the viewport origin, the top-left corner, so every piece swung in a
 * wide circle instead of tumbling: the "travels in circles" bug.
 */
function Confetti({
  reduced,
  view,
  seed,
}: {
  reduced: boolean;
  view: { x: number; y: number; w: number; h: number };
  /** Varies the pattern per letter, so a word's tiles don't celebrate in lockstep. */
  seed: number;
}) {
  const inset = 10;
  const span = Math.max(1, Math.round(view.w - 2 * inset - 6)); // 6 = piece width: the right edge stays inside
  const fall = Math.round(view.h * 0.72); // most of the visible height, at any LOD
  return (
    <g>
      {Array.from({ length: 16 }, (_, i) => {
        // spread across the visible width — 137 is coprime with typical spans, so no clustering
        const x = view.x + inset + ((i * 137 + seed * 53) % span);
        const c = CONFETTI[(i + seed) % CONFETTI.length];
        const delay = ((i + seed) % 8) * 0.18;
        const startY = view.y + 6 + ((i * 29 + seed * 7) % 22); // a ragged start, not a single row
        return (
          <rect
            key={i}
            x={x}
            y={reduced ? startY + ((i * 53) % Math.max(1, Math.round(view.h * 0.45))) : startY}
            width={6}
            height={9}
            rx={1.5}
            fill={c}
            opacity={reduced ? 1 : undefined}
            className={reduced ? "" : "animate-tc-confetti"}
            style={
              reduced
                ? undefined
                : ({
                    animationDelay: `${delay}s`,
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    "--tc-fall": `${fall}px`,
                  } as CSSProperties)
            }
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
  fluid = false,
  tier,
  still = false,
  index = 0,
}: TileCharacterProps) {
  // A still frame holds the whole character still, not only its finish: a grid of cards would
  // otherwise run each tile's idle bounce, hundreds of repainting animations (the Bag's words).
  const reduced = usePrefersReducedMotion() || still;
  const lowPower = useLowPower();
  const uid = useId().replace(/:/g, ""); // unique, SVG-id-safe (avoids clip/filter id collisions)
  const holoPaint = `url(#tc-holo-${uid})`;

  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  const expr = EXPR[state];
  const tilt = TILT[state];
  const g: Gild = upper ? gild : 0; // gild is UPPERCASE-only
  const holo = g >= 5 ? holoPaint : undefined; // the foil, only on a Holographic tile

  // level of detail by rendered size (spec §9) — limbs simplify, glyph never degrades
  const lod: Exclude<TileDetail, "auto"> =
    detail !== "auto" ? detail : size >= 100 ? "full" : size >= 60 ? "bust" : "tile";
  const showLimbs = lod === "full";
  const showFace = lod !== "tile";
  // each LOD crops to what it draws, so the rendered box stays tight (no empty limb space in
  // grids). Gilded tiles widen the crop symmetrically so the brass ring stack never clips.
  const baseView =
    lod === "full"
      ? { x: 0, y: 0, w: VB.w, h: VB.h, margin: 999 }
      : lod === "bust"
        ? { x: 24, y: 58, w: 192, h: 204, margin: 21 }
        : { x: 30, y: 86, w: 180, h: 180, margin: 15 };
  // every UPPERCASE tile draws a ring (the pale-blue LHAW skin at gild 0, brass once gilded),
  // so the crop must widen for any upper tile — not only gilded ones — or the ring clips.
  const gildPad = upper ? Math.max(0, Math.ceil(ringOuter(g)) - baseView.margin) : 0;
  const VIEW = {
    x: baseView.x - gildPad,
    y: baseView.y - gildPad,
    w: baseView.w + 2 * gildPad,
    h: baseView.h + 2 * gildPad,
  };

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

  // the word's rarity, as the tile's material (lib/rarityFinish, ./TileFinish). It moves
  // only where the whole character is drawn; a hungry word loses its shine, a peckish one dims.
  const fin = finishFor(tier);
  const motion: FinishMotion =
    state === "hungry" ? "rest" : reduced || lowPower || still || lod !== "full" ? "off" : "on";
  // a peckish word's shine is dimmed, moving or still
  const finDim = state === "peckish";
  const finSmall = lod === "tile";
  // eyelids match the tile (the top of a finished face, where the eyes sit: the tint over the face)
  const lidFill = fin ? mixHex(faceFill, fin.face[0], fin.alpha) : faceFill;

  const Glove = ({ gx, gy }: { gx: number; gy: number }) => (
    <g filter={boilFilter}>
      <circle cx={gx + 4} cy={gy + 4} r={6.5} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <circle cx={gx} cy={gy} r={13} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
    </g>
  );

  const svg = (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      width={fluid ? "100%" : size}
      height={fluid ? undefined : renderH}
      className="overflow-visible"
      style={fluid ? { display: "block", height: "auto" } : { display: "block" }}
    >
      {boil && showLimbs && (
        <defs>
          <filter id={`tc-boil-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={2} seed={seed} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      )}

      {/* Holographic foil: one gradient per tile, drifting unless reduced motion (stage 5 only) */}
      {g >= 5 && (
        <defs>
          <linearGradient id={`tc-holo-${uid}`} x1="0" y1="0" x2="0.6" y2="0.6" spreadMethod="reflect">
            {HOLO_STOPS.map(([o, c]) => (
              <stop key={o} offset={o} stopColor={c} />
            ))}
            {!reduced && (
              <animateTransform attributeName="gradientTransform" type="translate" values="0 0; 0.6 0.6; 0 0" dur="6s" repeatCount="indefinite" />
            )}
          </linearGradient>
        </defs>
      )}

      <FinishDefs tier={tier} uid={uid} bw={borderW} small={finSmall} motion={motion} />

      {/* gold burst rays (upgrade) — behind everything */}
      {state === "upgrade" && <BurstRays reduced={reduced} />}

      {/* ground shadow — static, anchors the figure. Wide, and sitting just under the shoes. */}
      {showLimbs && <ellipse cx={CX} cy={FOOT_Y + 2} rx={86} ry={12} fill={INK} opacity={0.17} />}

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

          {/* the rarity's aura, behind the tile */}
          {lod !== "tile" && <FinishAura tier={tier} uid={uid} motion={motion} dim={finDim} />}

          {/* UPPERCASE ring stack — pale-blue LHAW skin + any gild brass/sheen, all contiguous */}
          {upper && <Rings gild={g} holo={holo} />}

          {/* lowercase 3-D bottom edge (the wooden shelf) */}
          {!upper && <rect x={T.x} y={T.y + 7} width={T.w} height={T.h} rx={T.r} fill={EDGE_WOOD} />}

          {/* tile face */}
          <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={faceFill} stroke={border} strokeWidth={borderW} />
          {/* the rarity's material, a translucent tint over the face (facets, foil, glitter,
              frame), then the light passing under the letter */}
          <FinishSurface tier={tier} uid={uid} bw={borderW} small={finSmall} motion={motion} />
          <FinishLight tier={tier} uid={uid} bw={borderW} motion={motion} dim={finDim} index={index} />
          {/* the border again, over the material's edge */}
          {fin && <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill="none" stroke={border} strokeWidth={borderW} />}

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

          {/* the rarity's light over the letter (the streak, the glints, the fire) */}
          <FinishShine tier={tier} uid={uid} bw={borderW} motion={motion} dim={finDim} small={finSmall} index={index} />

          {/* crown topper (gild 4) — a full-character flourish; in compact word rows the gild
              still reads via the rings + pips (one crown per letter would clutter / clip) */}
          {showLimbs && g >= 4 && <Crown base={TOP - ringOuter(g)} paint={g >= 5 ? holo : GOLD} />}

          {/* gild pips on the lower face */}
          <Pips gild={g} holo={holo} plate={!!fin} />

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
              {...(fin ? { stroke: "#fffaf0", strokeWidth: 4, strokeLinejoin: "round" as const, paintOrder: "stroke" } : {})}
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
                  <Eye ex={CX - 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={lidFill} id={`${uid}l`} />
                  <Eye ex={CX + 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={lidFill} id={`${uid}r`} />
                </g>
              )}
              {expr.eyes !== "open" && (
                <>
                  <Eye ex={CX - 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={lidFill} id={`${uid}l`} />
                  <Eye ex={CX + 26} ey={eyeY} r={eyeR} expr={expr} look={0} face={lidFill} id={`${uid}r`} />
                </>
              )}
              <path d={browPath(CX - 26, eyeY - eyeR - 4, expr.brow, 1)} stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
              <path d={browPath(CX + 26, eyeY - eyeR - 4, expr.brow, -1)} stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
            </g>
          )}

          {/* rare-letter glint — a corner badge (not part of the face), so show it at every LOD
              incl. dense grids/word rows, matching the legacy tile. Gilded tiles use twinkles. */}
          {RAREST.has(char.toUpperCase()) && g === 0 && (!fin || finSmall) && (
            <path d={star4(T.x + T.w - 6, T.y + 6, 6, 2.2)} fill={GOLD} stroke={INK} strokeWidth={0.8} className={reduced ? "" : "animate-tc-twinkle"} style={PLANT} />
          )}
          {/* on a finished tile, the rare-letter mark is a soft gold glint in the same corner */}
          {RAREST.has(char.toUpperCase()) && g === 0 && fin && !finSmall && (
            <Glint x={T.x + T.w - 6} y={T.y + 6} s={0.75} color={GOLD} delay={0} anim={false} />
          )}

          {/* gild twinkles — riding the rings */}
          <Twinkles gild={g} reduced={reduced || motion === "off" || motion === "rest"} holo={holo} soft={fin && !finSmall ? fin.glow : undefined} />

          {/* the rarity's motes, drifting up */}
          {lod === "full" && <FinishMotes tier={tier} uid={uid} motion={motion} dim={finDim} seed={seed} index={index} />}
        </g>
      </g>

      {/* per-state extras anchored to the scene */}
      {showFace && state === "hungry" && <Zzz reduced={reduced} />}
      {showFace && state === "rolling" && <Huh reduced={reduced} />}
      {showFace && state === "eating" && <Snack />}
      {state === "celebrate" && <Confetti reduced={reduced} view={VIEW} seed={(((char.toUpperCase().charCodeAt(0) - 65) % 26) + 26) % 26} />}
    </svg>
  );

  const label = `${glyph} tile${upper ? " (UPPERCASE)" : ""}, ${state}${g >= 5 ? " · holographic" : g ? ` · gilded ${g}` : ""}`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`relative inline-flex items-center justify-center transition-transform ${
        selected ? "-translate-y-1" : ""
      } ${dim ? "opacity-35" : ""} ${onClick ? "tile-press" : ""} ${className}`}
      style={{ width: fluid ? "100%" : size, ...style }}
    >
      {svg}
      {count !== undefined && count > 1 && (
        <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink bg-card px-1 text-[11px] font-bold">
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
  tier,
  still,
}: {
  word: string;
  upper: boolean[];
  state?: TileState;
  gild?: Gild;
  size?: number;
  detail?: TileDetail;
  className?: string;
  /** The word's rarity, worn as its tiles' material (lib/rarityFinish). */
  tier?: Tier;
  /** The finish without its motion. */
  still?: boolean;
}) {
  const letters = [...word];
  // full-size words show characters "holding hands" (link pose, arms overlap); smaller word
  // rows have no limbs, so they sit in a neat row with a small positive gap instead.
  const full = detail === "full" || (detail === "auto" && size >= 100);
  // a full-size finished word has its moments (only full-size tiles draw the finish's motion), while
  // it's on screen: a word scrolled away, or a copy hidden at this width, holds still
  const row = useRef<HTMLDivElement>(null);
  const moving = full && !still && state !== "hungry" && !!finishFor(tier);
  const onScreen = useOnScreen(row, moving);
  const [moment, play] = useFinishMoment(tier, moving && onScreen, word);
  return (
    <div
      ref={row}
      className={`flex items-end justify-center ${moment ? "rf-moment" : ""} ${className}`}
      style={full ? undefined : { gap: Math.max(2, Math.round(size * 0.08)) }}
      onPointerEnter={full ? play : undefined}
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
            tier={tier}
            still={still}
            index={i}
          />
        </div>
      ))}
    </div>
  );
}
