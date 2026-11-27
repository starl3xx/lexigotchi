"use client";
/**
 * TileCharacter — the vaudeville rubber-hose tile (design handoff §1–9; the letter review,
 * decisions.md #28).
 *
 * A Scrabble-style letter tile come to life: the letter is *printed on the tile* (the face), with
 * pie-eyes perched on the top edge, noodle arms and legs, mitts, and bean shoes. No mouth: all
 * expression is eyes, lids, brows, and the body's lean. One parameterised component draws every
 * glyph, both cases, all 7 states and every gild stage (never hand-author per-letter art).
 *
 * Cases (the "glow-up"): lowercase = the kid (warm cream wood). UPPERCASE = the grown-up — it
 * literally becomes the blue Let's Have A Word! input tile. Case is derived, never stored.
 *
 * Level-of-detail (spec §9): the printed glyph never degrades; only the limbs simplify at small
 * sizes. `full` = whole character; `bust` = tile + face, no limbs; `tile` = face only (the
 * dense-grid / word-row form). Auto-selected by size, overridable via `detail`.
 *
 * THE DRAWING IS UP TO FOUR STACKED LAYERS, each its own <svg>: the floor (shadow, shoes), the legs,
 * the body (rings, arms, tile, face), and the top (held hands, a snack), with a raised
 * letter's rays as a layer of their own behind them; an empty one isn't
 * drawn, so a small tile in a grid is the body alone. The loops (the breath,
 * a jump) are CSS transforms on the legs and body LAYERS, never on a shape inside one. A browser
 * slides a finished layer without redrawing it; a transform inside an <svg> makes WebKit (every
 * iPhone browser and mini-app host) redraw the whole letter on every frame. Measured for one word
 * at rest: 47% of a processor core as shapes inside one <svg>, 6.5% as layers. Keep it that way:
 * anything that loops goes on a layer, and anything inside a layer moves in MOMENTS (a blink, a
 * twinkle, the finish's light), never forever. Feet stay planted because the legs layer stretches
 * from the feet while the body layer rises. `flat` draws the same thing as ONE <svg> (the layers
 * as groups) for a picture that must be a single file (scripts/docs-art.tsx).
 *
 * Life comes from one timer for a word (useWordLife), never one a tile: blinks, glances, a
 * twinkle. Reduced-motion (spec §7) drops to the still pose carried by eyes, lids, brows, and lean.
 */
import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { LETTERS_BY_FREQUENCY, scrabbleValue, type Tier } from "@/lib/economy";
import { finishFor, mixHex, type TileTier } from "@/lib/rarityFinish";
import type { CollabLook } from "@/lib/collabLook";
import { tileTierOf, useCollabLook } from "./collabLooksContext";
import { LINK_OVERLAP } from "@/components/scenes/layout";
import {
  ARM_BRACE,
  ARM_BRACE_R,
  ARM_HIP,
  ARM_REST,
  ARM_REST_R,
  ARM_WAVE,
  BORDER_LOW,
  BORDER_UP,
  BOT,
  CLASP,
  CX,
  DARTS_FROM,
  FOOT_LX,
  FOOT_RX,
  FOOT_Y,
  GROUND_Y,
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
  SHADOW_LINES,
  SHADOW_LINE_OPACITY,
  SHINE_FROM,
  SHOE,
  SHOE_SHINE,
  T,
  TOP,
  VB,
  eyeBox,
  laurel,
  leanFor,
  mittAt,
  pipPath,
  pupilOf,
  ringOuter,
  ringRects,
  type Arm,
  type Hand,
  type RingPart,
  tileOuter,
} from "./tileShapes";

export { WORD_LEAN, leanFor } from "./tileShapes";
import { FinishAura, finishHasAura, FinishDefs, FinishLight, FinishMotes, FinishShine, FinishSurface, Glint, MOMENT_END_S, finishFace, finishHasMotes, momentPieces, type FinishMotion, type MomentPiece } from "./TileFinish";

export type TileState = "idle" | "peckish" | "hungry" | "eating" | "rolling" | "upgrade" | "celebrate";
export type TilePose = "rest" | "hero";
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
  tier?: TileTier;
  /** A still frame: the character and its finish hold still (a still scene, a card in a grid, a thumbnail). */
  still?: boolean;
  /** The letter's place in its word, so the finish's light passes along the word in turn. */
  index?: number;
  /** This letter holds its left / right neighbour's hand (a word). The clasp between two letters is
   *  drawn once, by the letter on the right; an end letter's outer arm hangs at rest. */
  linkLeft?: boolean;
  linkRight?: boolean;
  /** A resting lean in degrees, about the feet (a hand-placed tile; leanFor). Mood adds to it. */
  lean?: number;
  /** One <svg> instead of four stacked layers, for a picture that must be a single file (the docs'
   *  art). The loops then run on groups inside it, which costs a redraw a frame: never in the app. */
  flat?: boolean;
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
// gradient per tile (id from useId; its colours are tileShapes' HOLO_STOPS), drifting slowly unless
// the viewer prefers reduced motion.

// the 6 rarest letters earn a little glint regardless of state
const RAREST = new Set(LETTERS_BY_FREQUENCY.slice(-6));

// ---------------------------------------------------------------------------
// Expression + motion presets, keyed by state.
// ---------------------------------------------------------------------------
type EyeMode = "open" | "closed" | "squeeze";
type Brow = "none" | "raised" | "worried" | "sad";
interface Expr {
  eyes: EyeMode;
  /** fraction of the eye a smile pushes the LOWER lid up over (open eyes only) */
  smile?: number;
  /** fraction of the eye the lid covers (open eyes only) */
  lid: number;
  /** how far the lid's outer corner droops, in units (a tired eye) */
  slant: number;
  brow: Brow;
}
const EXPR: Record<TileState, Expr> = {
  // Wide open at rest, and no brows: a half-lid on every idle letter read as bored (and, with the
  // rim and an arched brow, as glasses). A brow now always means a feeling.
  idle: { eyes: "open", lid: 0, slant: 0, brow: "none" },
  peckish: { eyes: "open", lid: 0.4, slant: 3.5, brow: "sad" },
  hungry: { eyes: "closed", lid: 0, slant: 0, brow: "sad" },
  eating: { eyes: "open", lid: 0, slant: 0, smile: 0.5, brow: "raised" },
  // can't look: eyes squeezed shut, one peeking now and then (no "?" over the head)
  rolling: { eyes: "squeeze", lid: 0, slant: 0, brow: "worried" },
  upgrade: { eyes: "open", lid: 0, slant: 0, brow: "raised" },
  celebrate: { eyes: "open", lid: 0, slant: 0, smile: 0.42, brow: "raised" },
};
// The body layer's loop per state (tailwind.config.ts, the tc-* keyframes). Idle breathes: slow
// and small, where it used to bounce to a beat.
const BODY_ANIM: Record<TileState, string> = {
  idle: "animate-tc-breathe",
  peckish: "animate-tc-sigh",
  hungry: "animate-tc-sleep",
  eating: "animate-tc-eat",
  rolling: "animate-tc-brace",
  upgrade: "animate-tc-hop",
  celebrate: "animate-tc-jump",
};
// The legs layer keeps the feet planted while the body moves: each body loop has its leg loop.
const LEG_ANIM: Record<TileState, string> = {
  idle: "animate-tc-legbreathe",
  peckish: "animate-tc-legsigh",
  hungry: "",
  eating: "",
  rolling: "animate-tc-knock",
  upgrade: "animate-tc-leghop",
  celebrate: "animate-tc-legjump",
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

// A word that can't look (the ascend sheet): how far each letter runs behind the one before it.
// The tremble's step is a part of its 0.17 s shake that never lands two letters in step; the peek's
// spreads five letters over its 3.2 s cycle out of order, so they peek one at a time, not in a wave.
const BRACE_STEP_S = 0.07;
const SWEAT_STEP_S = 0.37;
const PEEK_CYCLE_S = 3.2; // tailwind.config.ts, tc-peek-open / tc-peek-shut
const PEEK_STEP_S = 1.28;

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
 * Whether this browser is WebKit: Safari, and every browser and mini-app host on an iPhone (they
 * all draw with WebKit). Read once and SSR-safe (false until mounted).
 *
 * It decides one thing: how a finished tile's moving light is drawn (below, `splitBody`). The two
 * engines want opposite things, measured on one word over 30 to 40 s:
 * - WebKit redraws a whole <svg> on every frame that anything moves inside it. With the light as
 *   shapes inside the letter's drawing a Legendary word cost 35% of a processor core, and 17% with
 *   each moving piece a layer of its own (a Rare word 23% and 11%; a Common word about 9%).
 * - Headless Chrome, slowed four times, draws only what changed and pays for each layer instead:
 *   the same Legendary word cost 99% with the light inside the drawing and 106% as layers (a Mythic
 *   one 104% and 119%).
 * So WebKit gets the layers, and every other engine keeps the single drawing it has always had.
 * By the engine's maker, not the user agent: Chrome on an iPhone is WebKit and says "Apple" here.
 */
let webKitCache: boolean | null = null;
function readWebKit(): boolean {
  if (webKitCache !== null) return webKitCache;
  webKitCache = typeof navigator !== "undefined" && /Apple/.test(navigator.vendor ?? "");
  return webKitCache;
}
/**
 * `ask`: only a tile that could be cut asks. The answer is a state set after mount, so asking
 * renders the tile a second time in WebKit: a tile with no finish, or one that holds still, must
 * not pay that (a grid of letters would render twice on every iPhone).
 */
export function useWebKit(ask: boolean): boolean {
  const [is, setIs] = useState(false);
  useEffect(() => {
    if (ask) setIs(readWebKit());
  }, [ask]);
  return ask && is;
}
/** For tests: read the engine again (it is read once, as it can't change mid-session). */
export function forgetWebKit() {
  webKitCache = null;
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
export function useFinishMoment(tier: TileTier | undefined, active: boolean, word = ""): [boolean, () => void] {
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

// ===========================================================================
// Mitt — a palm, a thumb, and a cuff where the arm goes in. Two circles read as a ball.
// ===========================================================================
function Mitt({ hand, darts, filter }: { hand: Hand; darts: boolean; filter?: string }) {
  const { thumb, palm, cuff } = MITT;
  return (
    <g transform={mittAt(hand)} filter={filter}>
      <ellipse cx={thumb.cx} cy={thumb.cy} rx={thumb.rx} ry={thumb.ry} transform={`rotate(${thumb.rot} ${thumb.cx} ${thumb.cy})`} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <ellipse {...palm} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      {darts && <path d={MITT.darts} stroke={INK} strokeWidth={1.7} strokeLinecap="round" fill="none" />}
      <rect {...cuff} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
    </g>
  );
}

/** Two hands held: my left hand over my neighbour's right, my thumb across it (tileShapes, CLASP). */
function Clasp({ darts }: { darts: boolean }) {
  const { cuff, cuffs, under, thumb, over } = CLASP;
  return (
    <g>
      {cuffs.map((t) => (
        <rect key={t} {...cuff} transform={t} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      ))}
      <ellipse {...under} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      <ellipse cx={thumb.cx} cy={thumb.cy} rx={thumb.rx} ry={thumb.ry} transform={`rotate(${thumb.rot} ${thumb.cx} ${thumb.cy})`} fill={EYE_WHITE} stroke={INK} strokeWidth={2.6} />
      <ellipse {...over} fill={EYE_WHITE} stroke={INK} strokeWidth={2.8} />
      {darts && <path d={CLASP.darts} stroke={INK} strokeWidth={1.7} strokeLinecap="round" fill="none" />}
    </g>
  );
}

// ===========================================================================
// Eye — a tall oval with one big pupil. Open, it can wear a lid; shut, it keeps its shape (the eyes
// are the character's head: an arc alone leaves a plain tile). Every open eye carries a second
// drawing of itself shut, shown for the moment of a blink (.tc-blink on the tile; globals.css).
// ===========================================================================
function Eye({
  ex,
  ey,
  rx,
  ry,
  expr,
  side,
  face,
  id,
  peek = false,
  peekDelay = 0,
}: {
  ex: number;
  ey: number;
  rx: number;
  ry: number;
  expr: Expr;
  /** -1: the left eye · 1: the right */
  side: -1 | 1;
  face: string; // eyelid fill (matches the tile face)
  id: string;
  /** rolling: this eye opens for a moment now and then */
  peek?: boolean;
  /** How far into the peek's cycle this eye starts, in seconds (a word's letters peek in turn). */
  peekDelay?: number;
}) {
  const ball = (fill: string) => <ellipse cx={ex} cy={ey} rx={rx} ry={ry} fill={fill} stroke={INK} strokeWidth={3.2} />;
  const line = (d: string, w = 3.6) => <path d={d} stroke={INK} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  const a = rx * 0.66;
  const shut = {
    // lashes down: a blink, or asleep
    closed: `M ${ex - a} ${ey + ry * 0.12} Q ${ex} ${ey + ry * 0.58} ${ex + a} ${ey + ry * 0.12}`,
    // screwed up tight: a chevron pointing at the nose
    squeeze: `M ${ex + side * a * 0.75} ${ey - ry * 0.32} L ${ex - side * a * 0.7} ${ey + ry * 0.06} L ${ex + side * a * 0.75} ${ey + ry * 0.44}`,
  };
  const pupil = pupilOf(ex, ey, rx, ry, side, !!expr.smile);
  const clip = `tc-eye-${id}`;
  const lidY = ey - ry + expr.lid * 2 * ry;
  const yL = lidY + (side === -1 ? expr.slant : -expr.slant);
  const yR = lidY + (side === 1 ? expr.slant : -expr.slant);
  const open = (wide: boolean) => (
    <>
      <defs>
        <clipPath id={clip}>
          <ellipse cx={ex} cy={ey} rx={rx} ry={ry} />
        </clipPath>
      </defs>
      {ball(EYE_WHITE)}
      <g clipPath={`url(#${clip})`}>
        {/* the pupil, with the pie-slice cut that makes it a vaudeville eye (one highlight, not two) */}
        <g className={wide ? undefined : "tc-pupil"} transform={wide ? `translate(0 ${-ry * 0.2})` : undefined}>
          <ellipse cx={pupil.cx} cy={pupil.cy} rx={wide ? pupil.rx * 0.62 : pupil.rx} ry={wide ? pupil.ry * 0.62 : pupil.ry} fill={INK} />
          {!wide && <path d={pupil.cut} fill={EYE_WHITE} />}
        </g>
        {/* a smile pushes the lower lid up: a happy eye that keeps its pupil (an arc alone, inside the
            eye's outline, reads as a frown) */}
        {!wide && !!expr.smile && (
          <path
            d={`M ${ex - rx - 4} ${ey + ry + 4} L ${ex + rx + 4} ${ey + ry + 4} L ${ex + rx + 4} ${ey + ry - expr.smile * 2 * ry + 7} Q ${ex} ${ey + ry - expr.smile * 2 * ry - 9} ${ex - rx - 4} ${ey + ry - expr.smile * 2 * ry + 7} Z`}
            fill={face}
            stroke={INK}
            strokeWidth={3}
          />
        )}
        {/* the lid, its outer corner drooping when tired */}
        {!wide && expr.lid > 0.02 && (
          <path
            d={`M ${ex - rx - 4} ${ey - ry - 4} L ${ex + rx + 4} ${ey - ry - 4} L ${ex + rx + 4} ${yR} Q ${ex} ${lidY + 2} ${ex - rx - 4} ${yL} Z`}
            fill={face}
            stroke={INK}
            strokeWidth={3}
          />
        )}
      </g>
      <ellipse cx={ex} cy={ey} rx={rx} ry={ry} fill="none" stroke={INK} strokeWidth={3.2} />
    </>
  );
  if (expr.eyes !== "open") {
    // both halves of the swap start at the same point of the cycle, or the eye would show twice
    const at = peek && peekDelay ? { animationDelay: `${(-peekDelay).toFixed(2)}s` } : undefined;
    return (
      <g>
        <g className={peek ? "animate-tc-peek-shut" : undefined} style={at}>
          {ball(face)}
          {line(shut[expr.eyes])}
        </g>
        {peek && (
          <g className="animate-tc-peek-open" opacity={0} style={at}>
            {open(true)}
          </g>
        )}
      </g>
    );
  }
  return (
    <g>
      <g className="tc-eye-open">{open(false)}</g>
      <g className="tc-eye-shut" visibility="hidden">
        {ball(face)}
        {line(shut.closed)}
      </g>
    </g>
  );
}

function browPath(ex: number, y: number, brow: Brow, side: -1 | 1): string {
  const inner = ex - side * 9; // toward the nose
  const outer = ex + side * 9;
  switch (brow) {
    case "worried":
      return `M ${outer} ${y + 4} Q ${ex} ${y - 1} ${inner} ${y - 4}`; // inner up, outer down
    case "sad":
      return `M ${outer} ${y + 5} Q ${ex} ${y} ${inner} ${y - 3}`;
    case "raised":
      return `M ${outer} ${y} Q ${ex} ${y - 7} ${inner} ${y}`;
    default:
      return "";
  }
}

// ===========================================================================
// Gild layers (UPPERCASE only, spec §6; decisions.md #48): slim rings, twinkles, black pips, laurels.
// ===========================================================================
function star4(cx: number, cy: number, R = 7, r = 2.6) {
  const p: string[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    // rounded: the server draws these too, and engines differ in the last digit of a sine, which
    // React then reports as a mismatch when the browser takes the page over
    p.push(`${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`);
  }
  return `M ${p.join(" L ")} Z`;
}

/** The rings outside the blue tile border (tileShapes, ringRects): the pale-blue LHAW skin at
 *  gild 0; once gilded, GOLD REPLACES it. Holographic paints the gold rings with the foil (`holo`,
 *  a gradient url) and turns the pale line white so the colours read. */
function Rings({ gild, holo }: { gild: Gild; holo?: string }) {
  const paint = (part: RingPart) => (part === "plain" ? LHAW_RING : part === "gold" ? (gild >= 5 && holo ? holo : BRASS) : gild >= 5 ? EYE_WHITE : SHEEN);
  return (
    <>
      {ringRects(gild).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="none" stroke={paint(r.part)} strokeWidth={r.sw} />
      ))}
    </>
  );
}

function Twinkles({ gild, holo, soft, crowned = false }: { gild: Gild; holo?: string; soft?: string; crowned?: boolean }) {
  if (gild <= 0) return null;
  const ro = ringOuter(gild);
  const items = [
    { x: T.x + T.w + ro - 4, y: T.y - ro + 10, show: true, d: 0 },
    { x: T.x - ro + 4, y: MID + 14, show: gild >= 2, d: 0.5 },
    // over the head, where the laurels are when the letter wears them
    { x: CX + 34, y: T.y - ro - 2, show: gild >= 4 && !crowned, d: 1 },
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
            className="tc-star"
            style={{ animationDelay: `${t.d}s`, ...PLANT } as CSSProperties}
          />
        ))}
    </>
  );
}

/** One pip per stage of the word ladder (tileShapes, pipPath): black diamonds. An earned pip is
 *  solid ink at every stage, Holographic too; one not yet reached is a faint outline. */
function Pips({ gild }: { gild: Gild }) {
  if (gild <= 0) return null;
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) =>
        i < gild ? <path key={i} d={pipPath(i)} fill={INK} stroke={INK} strokeWidth={2.1} strokeLinejoin="round" /> : <path key={i} d={pipPath(i)} fill="none" stroke={INK} strokeOpacity={0.26} strokeWidth={1.9} strokeLinejoin="round" />,
      )}
    </g>
  );
}

/** The laurels a letter wears from Gilded 4 (tileShapes, laurel): gold, or the foil at Holographic.
 *  Drawn in the body, so they move with the tile. */
function Laurels({ ro, paint = GOLD }: { ro: number; paint?: string }) {
  const l = laurel(ro);
  const sprig = (
    <>
      <path d={l.stem} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      {l.leaves.map((t, i) => (
        <path key={i} d={LAUREL_LEAF} transform={t} fill={paint} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      ))}
    </>
  );
  return (
    <g>
      {sprig}
      <g transform={`translate(${VB.w} 0) scale(-1 1)`}>{sprig}</g>
    </g>
  );
}

// ===========================================================================
// State extras (zzz / ? / snack / burst rays / confetti).
// ===========================================================================
/**
 * The rays behind a raised letter, engraved (decisions.md #48): a "glory", as engravers draw
 * light: fine ruled rays of three lengths, twelve wedges with pale light inside them, and a ring of
 * beads, in the game's bright gold. It is not part of the letter, so it is drawn like the cards and
 * not like the letter.
 *
 * ONE STILL DRAWING. TileCharacter turns it as a whole layer, never as a loop inside a drawing:
 * the flat star it replaces turned inside the floor's drawing, and a raised letter cost 11% to 20%
 * of a processor core in WebKit for it (under 2% as a layer; headless, three runs).
 *
 * Every number is rounded: the server draws this too, and engines differ in a sine's last digit.
 */
const GLORY = (() => {
  const at = (r: number, t: number) => `${(CX + r * Math.cos(t)).toFixed(2)} ${(MID + r * Math.sin(t)).toFixed(2)}`;
  let fine = "";
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    // a wedge stands at every tenth ray; between them, three lengths
    const r1 = i % 10 === 0 ? 0 : i % 5 === 0 ? 126 : i % 2 === 0 ? 112 : 104;
    if (r1) fine += `M ${at(84, t)} L ${at(r1, t)}`;
  }
  let wedges = "";
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    wedges += `M ${at(84, t - 0.07)} L ${at(140, t)} L ${at(84, t + 0.07)}`;
  }
  let beads = "";
  for (let i = 0; i < 48; i++) {
    const t = ((i + 0.5) / 48) * Math.PI * 2;
    const x = (CX + 78 * Math.cos(t) - 1.5).toFixed(2);
    const y = (MID + 78 * Math.sin(t)).toFixed(2);
    beads += `M ${x} ${y} a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0 Z`;
  }
  return { fine, wedges, beads };
})();
function Glory() {
  return (
    <g>
      <path d={GLORY.fine} fill="none" stroke={GOLD} strokeWidth={1.25} strokeLinecap="round" opacity={0.95} />
      <path d={GLORY.wedges} fill={SHEEN} fillOpacity={0.6} stroke={GOLD} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
      <path d={GLORY.beads} fill={GOLD} />
    </g>
  );
}

/**
 * Confetti for a cheering letter, engraved (decisions.md #48, part 8): small stars, beads, curls,
 * and rings in the cards' two inks (ink and gold). It is not part of the letter, so it is drawn
 * like the cards; it was sixteen flat chips in five colours.
 *
 * **Each piece is a small drawing of its own**, placed over the letter, and its fall and its turn
 * run on that small drawing. The chips were sixteen shapes looping inside the top layer, and a
 * loop inside a layer makes WebKit redraw the whole layer on every frame: a cheering word cost 48%
 * of a processor core, and 3% with its confetti hidden (headless WebKit, five letters). A small
 * drawing of its own slides, turns, and fades without a redraw, and keeps a store only its own
 * size (a whole-letter layer for each of sixteen pieces would keep sixteen letters' worth).
 *
 * The pieces fall INSIDE the letter's own visible box (the LOD crop, always centred on the tile),
 * so a word row cheers letter by letter instead of spraying across its neighbours and the text
 * above. Each turns about its own middle: it is its own box.
 */
const CONFETTI_N = 16;
/** A piece's box, in the drawing's units: the piece is drawn round 0,0. */
const CONFETTI_BOX = 16;
type ConfettiKind = "star" | "bead" | "curl" | "ring";
const CONFETTI_KINDS: readonly ConfettiKind[] = ["star", "bead", "curl", "ring", "star", "curl", "bead", "star"];
function ConfettiPiece({ kind }: { kind: ConfettiKind }) {
  if (kind === "star") return <path d={star4(0, 0, 7, 2.7)} fill={GOLD} stroke={INK} strokeWidth={1.1} strokeLinejoin="round" />;
  if (kind === "curl") return <path d="M -6.2 2.2 C -3 -5 3 5 6.2 -2.2" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" />;
  if (kind === "ring") return <circle r={4.2} fill="none" stroke={GOLD} strokeWidth={2.1} />;
  return (
    <>
      <circle r={4} fill={SHEEN} stroke={INK} strokeWidth={1.2} />
      <circle r={1.6} fill={GOLD} />
    </>
  );
}
/** Where each piece starts, where it rests when nothing moves, what it is, and when its fall begins. */
function confettiSpots(view: { x: number; y: number; w: number; h: number }, seed: number) {
  const inset = 10;
  const span = Math.max(1, Math.round(view.w - 2 * inset - CONFETTI_BOX)); // the right edge stays inside
  return Array.from({ length: CONFETTI_N }, (_, i) => {
    // spread across the visible width: 137 is coprime with typical spans, so no clustering
    const x = view.x + inset + ((i * 137 + seed * 53) % span);
    const y = view.y + 6 + ((i * 29 + seed * 7) % 22); // a ragged start, not a single row
    return {
      x,
      y,
      /** held still (reduced motion, a picture): spread down the box instead of in a row at the top */
      rest: y + ((i * 53) % Math.max(1, Math.round(view.h * 0.45))),
      kind: CONFETTI_KINDS[(i + seed) % CONFETTI_KINDS.length],
      turn: (i * 47 + seed * 31) % 360,
      delay: ((i + seed) % 8) * 0.18,
    };
  });
}
function Confetti({
  reduced,
  flat,
  view,
  seed,
}: {
  reduced: boolean;
  /** one drawing (a picture): the pieces at rest, inside it */
  flat: boolean;
  view: { x: number; y: number; w: number; h: number };
  /** Varies the pattern per letter, so a word's tiles don't celebrate in lockstep. */
  seed: number;
}) {
  const spots = confettiSpots(view, seed);
  const half = CONFETTI_BOX / 2;
  // most of the visible height, at any LOD, as a share of the piece's own box (a translate's percent is of its own box)
  const fall = `${Math.round(((view.h * 0.72) / CONFETTI_BOX) * 100)}%`;
  // One drawing (a picture in a single file: the docs'): layers can't be had, so each piece is a
  // group. An unseen square gives the group the same box a piece's own drawing has, so the same
  // keyframes move it the same distance and turn it about its own middle.
  if (flat)
    return (
      <g key="confetti" data-layer="confetti">
        {spots.map((s, i) => (
          <g key={i} transform={`translate(${s.x + half} ${(reduced ? s.rest : s.y) + half})`}>
            <g
              className={reduced ? undefined : "animate-tc-confetti"}
              transform={reduced ? `rotate(${s.turn})` : undefined}
              style={reduced ? undefined : ({ transformBox: "fill-box", transformOrigin: "center", opacity: 0, animationDelay: `${s.delay.toFixed(2)}s`, "--tc-fall": fall } as CSSProperties)}
            >
              <rect x={-half} y={-half} width={CONFETTI_BOX} height={CONFETTI_BOX} fill="none" />
              <ConfettiPiece kind={s.kind} />
            </g>
          </g>
        ))}
      </g>
    );
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  return (
    <div key="confetti" data-piece="confetti" aria-hidden style={{ ...LAYER, pointerEvents: "none" }}>
      {spots.map((s, i) => (
        <svg
          key={i}
          viewBox={`${-half} ${-half} ${CONFETTI_BOX} ${CONFETTI_BOX}`}
          className={`overflow-visible ${reduced ? "" : "animate-tc-confetti"}`}
          style={
            {
              position: "absolute",
              left: pct((s.x - view.x) / view.w),
              top: pct(((reduced ? s.rest : s.y) - view.y) / view.h),
              width: pct(CONFETTI_BOX / view.w),
              height: pct(CONFETTI_BOX / view.h),
              ...(reduced ? { transform: `rotate(${s.turn}deg)` } : { opacity: 0, animationDelay: `${s.delay.toFixed(2)}s`, "--tc-fall": fall }),
            } as CSSProperties
          }
        >
          <ConfettiPiece kind={s.kind} />
        </svg>
      ))}
    </div>
  );
}

/**
 * A sleeping letter's three z's, rising from its top right corner, each larger than the last.
 *
 * Each z is a LAYER of its own (TileCharacter draws them), and its loop runs on the layer. They
 * were three shapes looping inside the top layer, and a loop inside a layer makes WebKit redraw
 * the whole layer on every frame: a hungry word on the Today stage, which Today shows first and
 * which may sleep there for days, cost 44% of a processor core at rest, and 5% with the z's held
 * still (headless WebKit, the real Today screen). On layers they slide and fade without a redraw.
 */
const ZS = [
  { x: T.x + T.w + 4, y: TOP + 6, s: 14 },
  { x: T.x + T.w + 16, y: TOP - 8, s: 18 },
  { x: T.x + T.w + 30, y: TOP - 24, s: 22 },
];
function Z({ z }: { z: (typeof ZS)[number] }) {
  return (
    <text x={z.x} y={z.y} fontSize={z.s} fill={INK} fontFamily="var(--font-body)" fontWeight={800}>
      z
    </text>
  );
}

/**
 * Rolling: beads of sweat flicking off the top corners (white, like the mitts: no red, no "?").
 *
 * Each bead is a LAYER of its own (TileCharacter draws them), as a sleeping letter's z's are, and
 * for the same reason: they were two shapes looping inside the top layer, which makes WebKit redraw
 * that layer on every frame. A word of five nervous letters (the ascend sheet) cost 45% of a
 * processor core that way, 27 points of it the beads (headless WebKit, a Common word alone,
 * 2026-11-25). On layers they fly and fade without a redraw.
 *
 * A bead flies along its own turn: `fx`, `fy` are that direction (the turn's sine, and minus its
 * cosine, typed so the server and the browser can't disagree in a last digit), which tcSweat reads
 * as --fx / --fy. `d` is the second bead's wait, so the two don't fly together.
 *
 * **The bead's point is at its bottom, toward the tile** (starl3xx, 2026-11-27: "flip the sweat
 * drops... the point at the bottom so it looks like its coming from the tile, not from above"). It
 * was drawn point up, the way a drop falls, so it read as rain landing on the letter. A drop thrown
 * off something leads with its round end and trails its point. The path starts at the point.
 */
const BEAD = "M 0 7 C 4 1 5 -3 0 -5 C -5 -3 -4 1 0 7 Z";
const SWEAT = [
  { dx: -58, turn: -40, fx: -0.643, fy: -0.766, d: 0 },
  { dx: 58, turn: 40, fx: 0.643, fy: -0.766, d: 0.7 },
];
const SWEAT_DY = -24; // above the eye line
function Bead({ x, y, turn }: { x: number; y: number; turn: number }) {
  return <path d={BEAD} fill={EYE_WHITE} stroke={INK} strokeWidth={2} transform={`translate(${x} ${y}) rotate(${turn})`} />;
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
/** A layer fills the tile's box, stacked on the layers before it. */
const LAYER: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "block" };

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
  linkLeft = false,
  linkRight = false,
  lean = 0,
  flat = false,
}: TileCharacterProps) {
  // A still frame holds the whole character still, not only its finish: a grid of cards would
  // otherwise run each tile's idle loop, hundreds of animations (the Bag's words).
  const reduced = usePrefersReducedMotion() || still;
  const lowPower = useLowPower();
  const uid = useId().replace(/:/g, ""); // unique, SVG-id-safe (avoids clip/filter id collisions)
  const holoPaint = `url(#tc-holo-${uid})`;

  const glyph = upper ? char.toUpperCase() : char.toLowerCase();
  const expr = EXPR[state];
  // a resting lean (a hand-placed tile) plus the mood's slump; the feet never tilt
  const tilt = TILT[state] + lean;
  const g: Gild = upper ? gild : 0; // gild is UPPERCASE-only
  const holo = g >= 5 ? holoPaint : undefined; // the foil, only on a Holographic tile

  // level of detail by rendered size (spec §9) — limbs simplify, glyph never degrades
  const lod: Exclude<TileDetail, "auto"> =
    detail !== "auto" ? detail : size >= 100 ? "full" : size >= 60 ? "bust" : "tile";
  const showLimbs = lod === "full";
  const showFace = lod !== "tile";
  // LEGS IN FRONT OF THE RING (decisions.md #48; starl3xx: "in the same way that arms come out in
  // front of gilding, could we do the same for legs?", then "has to be a layer in front of the
  // gilding... otherwise it doesn't work", for "every uppercase"). The ring was part of the body,
  // and the body is over the legs, so the gold hid most of each leg (at Gilded 4, 16 of its 52
  // units showed). Where a letter has legs, its rings (and the glow behind them) are a layer of
  // their own UNDER the legs: floor, rings, legs, body. A leg stays one unbroken line.
  const ringsApart = upper && showLimbs;
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
  const borderW = upper ? BORDER_UP : BORDER_LOW;
  const letterFill = upper ? LHAW_INK : INK;
  const letterFont = "var(--font-body)"; // Söhne bold for both cases (design review)
  const letterWeight = 800;

  // the eyes, riding the ring's outer edge on an UPPERCASE tile (tileShapes, eyeBox)
  const { rx: eyeRx, ry: eyeRy, dx: eyeDx, y: eyeY } = eyeBox(upper, ringOuter(g));
  // when pips are present, nudge the printed letter up so the two never collide
  const letterY = MID + 4 - (g >= 1 ? PIP_NUDGE : 0);
  const seed = char.toUpperCase().charCodeAt(0);
  const boilFilter = boil && showLimbs ? `url(#tc-boil-${uid})` : undefined;

  // The loops. A word's letters breathe each a little behind the last, like five creatures and not
  // one machine; the clasps stand still and the arms end under them, so that can't part hands.
  const calm = state === "idle" || state === "peckish";
  // A word waiting on a result trembles the same way: each letter a part of a shake behind the
  // last (the ascend sheet), where five in step read as one machine.
  const step = calm ? 0.6 : state === "rolling" ? BRACE_STEP_S : 0;
  const phase: CSSProperties | undefined = !reduced && step && index ? { animationDelay: `${(-index * step).toFixed(2)}s` } : undefined;
  // A small tile with no legs stands still at rest: a tile bobbing in the air isn't breathing, and a
  // grid of them (the loose letters on Today, the Bag) was a dozen loops for nothing.
  const restsStill = calm && !showLimbs;
  const bodyAnim = reduced || restsStill ? "" : BODY_ANIM[state];
  const legAnim = reduced ? "" : LEG_ANIM[state];
  const tiltT = tilt ? `rotate(${tilt} ${CX} ${BOT})` : undefined;

  // the word's rarity, as the tile's material (lib/rarityFinish, ./TileFinish). It moves
  // only where the whole character is drawn; a hungry word loses its shine, a peckish one dims.
  const fin = finishFor(tier);
  const motion: FinishMotion =
    state === "hungry" ? "rest" : reduced || lowPower || still || lod !== "full" ? "off" : "on";
  // The glow behind a rare tile goes under the legs with them, and on a lowercase letter too. As a
  // soft blur it faded out before it reached the legs; as line work its rays lay across their tops
  // (Bugbot on #263). So a letter with legs and a halo has that under-the-legs layer whatever its case.
  const haloUnder = showLimbs && finishHasAura(tier, motion);
  // a peckish word's shine is dimmed, moving or still
  const finDim = state === "peckish";
  const finSmall = lod === "tile";
  // eyelids match the tile (the top of a finished face, where the eyes sit: the tint over the face)
  const lidFill = fin ? mixHex(faceFill, fin.face[0], fin.alpha) : faceFill;

  // The arms. A side that holds a neighbour's hand reaches for the clasp; a free side hangs at
  // rest, holds on to the tile's corner when rolling, or strikes the hero pose.
  // A raised letter strikes the hero pose too: a hand on the hip, a wave (decisions.md #48).
  const hero = pose === "hero" || state === "upgrade";
  const armL: Arm | null = !showLimbs || linkLeft ? null : state === "rolling" ? ARM_BRACE : hero ? ARM_HIP : ARM_REST;
  const armR: Arm | null = !showLimbs || linkRight ? null : state === "rolling" ? ARM_BRACE_R : hero ? ARM_WAVE : ARM_REST_R;
  const darts = size >= DARTS_FROM; // the mitt's two stitches: only where they are more than a speck
  const limb = (d: string) => <path d={d} stroke={INK} strokeWidth={LIMB_W} fill="none" strokeLinecap="round" />;
  const freeArm = (a: Arm | null) =>
    a && (
      <g filter={boilFilter}>
        {limb(a.d)}
        {!a.front && <Mitt hand={a.hand} darts={darts} />}
      </g>
    );
  const frontMitt = (a: Arm | null) => a && a.front && <Mitt hand={a.hand} darts={darts} filter={boilFilter} />;

  // ── The four layers (the header says why) ─────────────────────────────────────────────────────
  // Distances in the loops' keyframes are in the drawing's units, through --ux / --uy: one unit as
  // a percent of the layer's own box, so translateY(calc(var(--uy) * -3)) is three units up at any
  // size. An origin is a point of the drawing as a percent of the box, for the same reason.
  const vb = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
  const units = { "--ux": `${(100 / VIEW.w).toFixed(4)}%`, "--uy": `${(100 / VIEW.h).toFixed(4)}%` } as CSSProperties;
  const originAt = (x: number, y: number) => `${(((x - VIEW.x) / VIEW.w) * 100).toFixed(3)}% ${(((y - VIEW.y) / VIEW.h) * 100).toFixed(3)}%`;
  // `timing` is a layer's own delay, in place of the letter's phase in its word (a z's turn among the three).
  const layer = (key: string, children: ReactNode, anim = "", origin?: string, timing: CSSProperties | undefined = phase) =>
    flat ? (
      <g key={key} data-layer={key} className={anim || undefined} style={origin ? ({ transformBox: "view-box", transformOrigin: origin, ...timing } as CSSProperties) : undefined}>
        {children}
      </g>
    ) : (
      <svg key={key} data-layer={key} viewBox={vb} aria-hidden className={`overflow-visible ${anim}`} style={origin ? { ...LAYER, transformOrigin: origin, ...timing } : LAYER}>
        {children}
      </svg>
    );

  // ── The body, in the order it is painted ─────────────────────────────────────────────────────
  // Three still pieces (base, mid, over) with the rarity's light between them. On most tiles all
  // of it is one layer (`body`, below). On a finished tile whose light moves, in WebKit, the body
  // is cut where the light sits, and every moving piece of the light is a layer of its own, its
  // moment run on that layer (./TileFinish, momentPieces). The header's rule is why, and a moment
  // is where it bit: measured on Today with a fed Legendary word over 40 s, 36% of a processor
  // core with the light inside the body (one glint moving alone was 27%), 20% cut this way, and
  // 10% for the same word with no moments. Every piece keeps its place in the paint order: the
  // glow under the letter, the streak over it and under the eyes.
  const leaned = (children: ReactNode) => (
    // static lean (SVG attr), then the hover's rise (globals.css, .tc-perk)
    <g transform={tiltT}>
      <g className="tc-perk">{children}</g>
    </g>
  );
  const bodyDefs = (
    <>
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
    </>
  );
  // under the light: the glow behind, the rings, the arms, the tile and its material
  const bodyBase = (
    <>
      {/* the rarity's aura, behind the tile */}
      {!ringsApart && !haloUnder && lod !== "tile" && <FinishAura tier={tier} outer={tileOuter(upper, g)} small={finSmall} motion={motion} dim={finDim} />}

      {/* UPPERCASE ring stack — pale-blue LHAW skin, or the gilding. A letter with legs draws it on
          a layer of its own, under the legs (ringsApart). */}
      {upper && !ringsApart && <Rings gild={g} holo={holo} />}

      {/* The arms go over the rings and under the face, so an UPPERCASE letter's arms show
          (they used to hide behind its ring). An arm that holds a neighbour's hand is drawn
          upright whatever the lean (the lean undone), toward where the hands meet. */}
      {showLimbs && (linkLeft || linkRight) && (
        <g transform={tilt ? `rotate(${-tilt} ${CX} ${BOT})` : undefined} filter={boilFilter}>
          {linkLeft && limb(LINK_L)}
          {linkRight && limb(LINK_R)}
        </g>
      )}
      {freeArm(armL)}
      {freeArm(armR)}

      {/* lowercase 3-D bottom edge (the wooden shelf) */}
      {!upper && <rect x={T.x} y={T.y + 7} width={T.w} height={T.h} rx={T.r} fill={EDGE_WOOD} />}

      {/* tile face */}
      <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={faceFill} stroke={border} strokeWidth={borderW} />
      {/* the rarity's material, a translucent tint over the face (facets, foil, glitter,
          frame), then the light passing under the letter */}
      <FinishSurface tier={tier} uid={uid} bw={borderW} small={finSmall} motion={motion} />
    </>
  );
  // the light passing under the letter (a moment)
  const bodyLight = <FinishLight tier={tier} uid={uid} bw={borderW} motion={motion} dim={finDim} index={index} />;
  // the border and the letter
  const bodyMid = (
    <>
      {/* the border again, over the material's edge */}
      {fin && <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill="none" stroke={border} strokeWidth={borderW} />}

      {/* the printed glyph — real text, razor-sharp at any size (spec §9) */}
      <text x={CX} y={letterY} textAnchor="middle" dominantBaseline="central" fontFamily={letterFont} fontWeight={letterWeight} fontSize={92} fill={letterFill}>
        {glyph}
      </text>
    </>
  );
  // the rarity's light over the letter: the streak, the glints, the fire (a moment)
  const bodyShine = <FinishShine tier={tier} uid={uid} bw={borderW} motion={motion} dim={finDim} small={finSmall} index={index} />;
  // over the light: the crown, the pips, the value, the mitts, the eyes
  const bodyOver = (
    <>
      {/* the laurels (Gilded 4 and Holographic), on a whole character; in compact word rows the gild
          still reads via the rings + pips */}
      {showLimbs && g >= 4 && <Laurels ro={ringOuter(g)} paint={g >= 5 ? holo : GOLD} />}

      {/* the stage's pips on the lower face */}
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
          {...(fin ? { stroke: "#fffaf0", strokeWidth: 4, strokeLinejoin: "round" as const, paintOrder: "stroke" } : {})}
        >
          {value ?? scrabbleValue(char)}
        </text>
      )}

      {/* a mitt that rests on the tile (holding on, hand on hip) */}
      {frontMitt(armL)}
      {frontMitt(armR)}

      {/* eyes + brows perched on the top edge */}
      {showFace && (
        <g>
          <Eye ex={CX - eyeDx} ey={eyeY} rx={eyeRx} ry={eyeRy} expr={expr} side={-1} face={lidFill} id={`${uid}l`} />
          <Eye ex={CX + eyeDx} ey={eyeY} rx={eyeRx} ry={eyeRy} expr={expr} side={1} face={lidFill} id={`${uid}r`} peek={state === "rolling" && !reduced} peekDelay={(index * PEEK_STEP_S) % PEEK_CYCLE_S} />
          {expr.brow !== "none" && (
            <g className="tc-brow" stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round">
              <path d={browPath(CX - eyeDx, eyeY - eyeRy - 5, expr.brow, -1)} />
              <path d={browPath(CX + eyeDx, eyeY - eyeRy - 5, expr.brow, 1)} />
            </g>
          )}
        </g>
      )}

      {/* rare-letter glint — a corner badge (not part of the face), so show it at every LOD
          incl. dense grids/word rows, matching the legacy tile. Gilded tiles use twinkles.
          It twinkles in a moment (.tc-spark, useWordLife), never in a loop. */}
      {RAREST.has(char.toUpperCase()) && g === 0 && (!fin || finSmall) && (
        <path d={star4(T.x + T.w - 6, T.y + 6, 6, 2.2)} fill={GOLD} stroke={INK} strokeWidth={0.8} className="tc-star" style={PLANT} />
      )}
      {/* on a finished tile, the rare-letter mark is a soft gold glint in the same corner */}
      {RAREST.has(char.toUpperCase()) && g === 0 && fin && !finSmall && (
        <Glint x={T.x + T.w - 6} y={T.y + 6} s={0.75} color={GOLD} delay={0} anim={false} />
      )}

      {/* gild twinkles — riding the rings */}
      <Twinkles gild={g} holo={holo} soft={fin && !finSmall ? fin.glow : undefined} crowned={showLimbs && g >= 4} />
    </>
  );
  // the rarity's motes, drifting up (a moment)
  const bodyMotes = lod === "full" && finishHasMotes(tier, motion, finDim, index) && <FinishMotes tier={tier} uid={uid} motion={motion} dim={finDim} seed={seed} index={index} />;
  // Cut only where the light moves, only in WebKit (useWebKit says why), and never in a
  // single-file picture. Only such a tile asks which engine this is.
  const splitBody = useWebKit(!flat && !!fin && motion === "on");
  const moment = splitBody ? momentPieces({ tier, uid, bw: borderW, dim: finDim, seed, index }) : null;
  // a still piece of a cut body
  const piece = (key: string, children: ReactNode) => (
    <svg key={key} viewBox={vb} aria-hidden className="overflow-visible" style={LAYER} data-piece={key}>
      {children}
    </svg>
  );
  // A point of the upright drawing, where the tile's lean puts it (the lean turns about the feet's
  // middle, as `leaned` does inside a drawing).
  const leanedPoint = (x: number, y: number): [number, number] => {
    if (!tilt) return [x, y];
    const a = (tilt * Math.PI) / 180;
    const [dx, dy] = [x - CX, y - BOT];
    return [CX + dx * Math.cos(a) - dy * Math.sin(a), BOT + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  // The lean and the hover's rise as LAYERS, for a piece that travels in the tile's leaned frame.
  const leanedLayers = (children: ReactNode) => (
    <div style={tilt ? { ...LAYER, transform: `rotate(${tilt}deg)`, transformOrigin: originAt(CX, BOT) } : LAYER}>
      <div className="tc-perk-layer" style={LAYER}>
        {children}
      </div>
    </div>
  );
  // The face, as a cut that stays put while a light crosses it: the same rounded rectangle the
  // single body clips to (./TileFinish, finishFace), in shares of the layer's box.
  const faceCut = (children: ReactNode) => {
    const f = finishFace(borderW);
    const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
    const [top, right, bottom, left] = [(f.y - VIEW.y) / VIEW.h, (VIEW.x + VIEW.w - f.x - f.width) / VIEW.w, (VIEW.y + VIEW.h - f.y - f.height) / VIEW.h, (f.x - VIEW.x) / VIEW.w];
    return <div style={{ ...LAYER, clipPath: `inset(${pct(top)} ${pct(right)} ${pct(bottom)} ${pct(left)} round ${pct(f.rx / VIEW.w)} / ${pct(f.rx / VIEW.h)})` }}>{children}</div>;
  };
  // The hover's rise alone as a layer, for a piece that carries the lean inside its own drawing:
  // along the leaned tile's own up, as `leaned` rises (the lean, the rise, the lean undone, which
  // together leave the piece exactly where it was until the tile rises).
  const riseLayer = (children: ReactNode) => {
    const turn = (deg: number): CSSProperties => (tilt ? { ...LAYER, transform: `rotate(${deg}deg)`, transformOrigin: originAt(CX, BOT) } : LAYER);
    return (
      <div style={turn(tilt)}>
        <div className="tc-perk-layer" style={LAYER}>
          <div style={turn(-tilt)}>{children}</div>
        </div>
      </div>
    );
  };
  // A moving piece of the light: a layer, its moment on the layer (never on a shape inside it).
  // TileFinish's MomentPiece says what each `frame` is.
  const momentLayer = (m: MomentPiece) => {
    const inside = m.frame === "leaned" || m.frame === "point";
    const origin = m.origin && (inside ? leanedPoint(m.origin[0], m.origin[1]) : m.origin);
    const svg = (
      <svg
        key={m.key}
        viewBox={vb}
        aria-hidden
        className={`overflow-visible ${m.cls}`}
        data-piece={m.key}
        style={{ ...LAYER, ...(origin ? { transformOrigin: originAt(origin[0], origin[1]) } : null), ...(m.waits ? { opacity: 0 } : null), animationDelay: `${m.delay.toFixed(2)}s` }}
      >
        {m.frame === "leaned" ? leaned(m.children) : m.frame === "point" ? <g transform={tiltT}>{m.children}</g> : m.children}
      </svg>
    );
    if (m.frame === "leaned") return svg;
    return <Fragment key={m.key}>{m.frame === "point" ? riseLayer(svg) : leanedLayers(m.frame === "cut" ? faceCut(svg) : svg)}</Fragment>;
  };
  // Moving pieces together under one opacity (a peckish word's dimmed light), as the single body
  // gives a group: where two pieces overlap, a piece-by-piece opacity would come out brighter.
  const momentGroup = (key: string, opacity: number, pieces: MomentPiece[]) =>
    pieces.length === 0 ? null : opacity < 1 ? (
      <div key={key} data-piece={key} style={{ ...LAYER, opacity }}>
        {pieces.map(momentLayer)}
      </div>
    ) : (
      <Fragment key={key}>{pieces.map(momentLayer)}</Fragment>
    );

  // A layer with nothing in it isn't drawn, so a small tile in a grid is one <svg>, as it was.
  const hasFloor = showLimbs;
  const hasTop = (showLimbs && linkLeft) || (showFace && state === "eating");
  // A still frame shows no sweat: a bead frozen in the air reads as an ear.
  const sweating = showFace && state === "rolling" && !reduced;
  const asleep = showFace && state === "hungry";
  const layers = [
    // a raised letter's rays, behind everything: a layer that turns as a whole (Glory says why)
    state === "upgrade" &&
      (flat ? (
        // one file (the docs' pictures): the same cut as a clip path, the same turn on a group
        <g key="rays" clipPath={showLimbs ? `url(#tc-ground-${uid})` : undefined}>
          {showLimbs && (
            <defs>
              <clipPath id={`tc-ground-${uid}`}>
                <rect x={VIEW.x - 200} y={VIEW.y - 200} width={VIEW.w + 400} height={GROUND_Y - VIEW.y + 200} />
              </clipPath>
            </defs>
          )}
          {layer("rays-turn", <Glory />, reduced ? "" : "animate-tc-ray", originAt(CX, MID), {})}
        </g>
      ) : (
        // The box stands still and cuts the rays off at the ground, so none shows between the
        // shadow's ruled lines (the light rises from behind the ground); only the drawing turns.
        <div key="rays" data-piece="rays" style={showLimbs ? { ...LAYER, clipPath: `inset(-40% -40% ${(((VIEW.y + VIEW.h - GROUND_Y) / VIEW.h) * 100).toFixed(2)}% -40%)` } : LAYER}>
          <svg viewBox={vb} aria-hidden className={`overflow-visible ${reduced ? "" : "animate-tc-ray"}`} style={{ ...LAYER, transformOrigin: originAt(CX, MID) }}>
            <Glory />
          </svg>
        </div>
      )),
    // the floor: what never moves
    hasFloor &&
      layer(
        "floor",
        <>
          {boil && showLimbs && (
            <defs>
              <filter id={`tc-boil-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={2} seed={seed} result="n" />
                <feDisplacementMap in="SourceGraphic" in2="n" scale={2} xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>
          )}
          {/* ground shadow: on the floor, whatever the figure does. Ruled lines, as the cards make tone (tileShapes, SHADOW_LINES). */}
          {showLimbs && (
            <g fill="none" stroke={INK} strokeLinecap="round" opacity={SHADOW_LINE_OPACITY}>
              {SHADOW_LINES.map((l) => (
                <path key={l.y} d={`M ${l.x0} ${l.y} H ${l.x1}`} strokeWidth={l.w} />
              ))}
            </g>
          )}
          {/* shoes — planted */}
          {showLimbs && (
            <g filter={boilFilter}>
              <path d={SHOE} fill={INK} transform={`translate(${FOOT_LX} ${FOOT_Y}) scale(-1 1)`} />
              <path d={SHOE} fill={INK} transform={`translate(${FOOT_RX} ${FOOT_Y})`} />
              {size >= SHINE_FROM && (
                <g stroke="#ffffff" strokeOpacity={0.55} strokeWidth={2.2} strokeLinecap="round" fill="none">
                  <path d={SHOE_SHINE} transform={`translate(${FOOT_LX} ${FOOT_Y}) scale(-1 1)`} />
                  <path d={SHOE_SHINE} transform={`translate(${FOOT_RX} ${FOOT_Y})`} />
                </g>
              )}
            </g>
          )}
        </>,
      ),

    // what a letter with legs wears under them: an UPPERCASE letter's rings, and the halo behind
    // a rare tile of either case. Under the legs, moving with the body (the same loop, the same
    // turn). The body's own paints (the foil) are found by id. The layer keeps the name "rings":
    // the share video cuts the letter into its layers by name (cards/loop/liveFront).
    (ringsApart || haloUnder) &&
      layer(
        "rings",
        leaned(
          <>
            <FinishAura tier={tier} outer={tileOuter(upper, g)} small={finSmall} motion={motion} dim={finDim} />
            {upper && <Rings gild={g} holo={holo} />}
          </>,
        ),
        bodyAnim,
        originAt(CX, BOT),
      ),

    // the legs: the layer stretches from the feet, so they stay planted while the body rises
    showLimbs &&
      layer(
        "legs",
        <g transform={tiltT}>
          <g className="tc-legs-perk" style={{ transformBox: "view-box", transformOrigin: `${CX}px ${FOOT_Y - 6}px` }} filter={boilFilter}>
            {limb(LEG_L)}
            {limb(LEG_R)}
          </g>
        </g>,
        legAnim,
        originAt(CX, FOOT_Y - 6),
      ),

    // the body: glow, rings, arms, the tile and its face (above: its pieces, and when they part)
    splitBody && moment ? (
      // The idle loop is on this wrapper, as it is on the body layer: a piece can't carry it and
      // its own moment.
      <div key="body" data-piece="body" className={bodyAnim} style={{ ...LAYER, transformOrigin: originAt(CX, BOT), ...phase }}>
        {piece("base", <>{bodyDefs}{leaned(bodyBase)}</>)}
        {momentGroup("light", moment.opacity, moment.under)}
        {piece("mid", leaned(bodyMid))}
        {momentGroup("shine", moment.opacity, moment.over)}
        {piece("over", leaned(bodyOver))}
        {momentGroup("motes", 1, moment.motes)}
      </div>
    ) : (
      layer(
        "body",
        <>
          {bodyDefs}
          {leaned(
            <>
              {bodyBase}
              {bodyLight}
              {bodyMid}
              {bodyShine}
              {bodyOver}
              {bodyMotes}
            </>,
          )}
        </>,
        bodyAnim,
        originAt(CX, BOT),
      )
    ),

    // the top: what stands still in front of the body
    hasTop &&
      layer(
        "top",
        <>
          {/* the hands this letter and its left neighbour hold */}
          {showLimbs && linkLeft && <Clasp darts={darts} />}
          {/* per-state extras anchored to the scene */}
          {showFace && state === "eating" && <Snack />}
        </>,
      ),

    // a cheering letter's confetti: over everything, each piece a small drawing of its own (Confetti says why)
    state === "celebrate" && <Confetti key="confetti" reduced={reduced} flat={flat} view={VIEW} seed={(((char.toUpperCase().charCodeAt(0) - 65) % 26) + 26) % 26} />,

    // a nervous letter's beads of sweat: a layer each, flying off along its own turn (SWEAT says
    // why). Unseen until its turn comes; a word's letters don't sweat in step, so each letter
    // starts its beads a little before the last.
    ...(sweating
      ? SWEAT.map((b, i) =>
          layer(`sweat${i}`, <Bead x={CX + b.dx} y={eyeY + SWEAT_DY} turn={b.turn} />, "animate-tc-sweat", originAt(CX + b.dx, eyeY + SWEAT_DY), {
            opacity: 0,
            animationDelay: `${(b.d - index * SWEAT_STEP_S).toFixed(2)}s`,
            "--fx": b.fx,
            "--fy": b.fy,
          } as CSSProperties),
        )
      : []),

    // a sleeping letter's z's: a layer each, so each can rise and fade without a redraw (ZS says why)
    ...(asleep ? ZS.map((z, i) => layer(`z${i}`, <Z z={z} />, reduced ? "" : "animate-tc-zzz", originAt(z.x + z.s * 0.28, z.y - z.s * 0.3), reduced ? undefined : { animationDelay: `${i * 0.5}s` })) : []),
  ];

  const label = `${glyph} tile${upper ? " (UPPERCASE)" : ""}, ${state}${g >= 5 ? " · holographic" : g ? ` · gilded ${g}` : ""}`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-label={label}
      data-tc=""
      className={`relative inline-flex items-center justify-center transition-transform ${
        selected ? "-translate-y-1" : ""
      } ${dim ? "opacity-35" : ""} ${onClick ? "tile-press" : ""} ${className}`}
      style={{ width: fluid ? "100%" : size, "--i": index, ...style } as CSSProperties}
    >
      {flat ? (
        <svg
          viewBox={vb}
          width={fluid ? "100%" : size}
          height={fluid ? undefined : Math.round(size * (VIEW.h / VIEW.w))}
          className="overflow-visible"
          style={{ display: "block", ...(fluid ? { height: "auto" } : null), ...units }}
        >
          {layers}
        </svg>
      ) : (
        <span className="relative block w-full" style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}`, ...units }}>
          {layers}
        </span>
      )}
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
// Life. One timer for a word (never one a tile, never a loop): every second or two one letter
// blinks, glances at a neighbour (--glance), or its star twinkles. Each is a class or a custom
// property set on the tile for a moment (globals.css says what they do), so between gestures
// nothing ticks.
// ===========================================================================
export function useWordLife(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let next = 0;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    // What each kind of gesture has pending on each tile: its ending. A newer gesture of the same
    // kind on the same tile takes the ending over, so an older one's timer can't cut it short (a
    // second glance landing on a letter mid-glance ended when the first was due to; Bugbot on #215).
    const ends = new WeakMap<Element, Map<string, number>>();
    const hold = (el: HTMLElement, kind: string, on: () => void, off: () => void, ms: number) => {
      const mine = ends.get(el) ?? new Map<string, number>();
      ends.set(el, mine);
      const before = mine.get(kind);
      if (before !== undefined) {
        window.clearTimeout(before);
        timers.delete(before);
      }
      on();
      const id = window.setTimeout(() => {
        timers.delete(id);
        mine.delete(kind);
        off();
      }, ms);
      timers.add(id);
      mine.set(kind, id);
    };
    const flash = (el: HTMLElement, cls: string, ms: number) =>
      hold(
        el,
        cls,
        () => el.classList.add(cls),
        () => el.classList.remove(cls),
        ms,
      );
    // The row is read from the ref at every tick, never kept: a host may swap the element under it
    // (the Today stage keys the word's row by word), and a timer holding the old one would go on
    // blinking a word that has left the page while the new one stared.
    const tiles = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-tc]") ?? []);
    const tick = () => {
      const all = tiles();
      if (all.length && !document.hidden) {
        const i = Math.floor(Math.random() * all.length);
        const el = all[i];
        const r = Math.random();
        if (r < 0.62) {
          flash(el, "tc-blink", BLINK_MS);
          if (Math.random() < 0.22) later(() => flash(el, "tc-blink", BLINK_MS), 280); // now and then, twice
          if (Math.random() < 0.3 && all[i + 1]) later(() => flash(all[i + 1], "tc-blink", BLINK_MS), 150); // a neighbour catches it
        } else if (r < 0.88) {
          // A glance: at a neighbour, or (an end letter) out at the world. It has a property of its
          // own, --glance, and the pointer writes each pupil's place itself (useGaze), which wins
          // while it is there (globals.css, .tc-pupil). Each sets and clears only its own, so neither can take
          // the eyes off the other: sharing one property did both ways (Bugbot on #215, twice).
          const dir = all.length === 1 ? (Math.random() < 0.5 ? -1 : 1) : i === 0 ? 1 : i === all.length - 1 ? -1 : Math.random() < 0.5 ? -1 : 1;
          hold(
            el,
            "glance",
            () => el.style.setProperty("--glance", String(dir * 0.9)),
            () => el.style.removeProperty("--glance"),
            900 + Math.random() * 1100,
          );
        } else {
          // a rare letter's star, or a gilded tile's, twinkles once (not one that is mid-twinkle:
          // the class is already on, so the animation wouldn't play again)
          const starred = all.filter((t) => t.querySelector(".tc-star") && !t.classList.contains("tc-spark"));
          if (starred.length) flash(starred[Math.floor(Math.random() * starred.length)], "tc-spark", SPARK_MS);
        }
      }
      next = window.setTimeout(tick, 800 + Math.random() * 1900);
    };
    next = window.setTimeout(tick, 500 + Math.random() * 900);
    return () => {
      window.clearTimeout(next);
      timers.forEach((id) => window.clearTimeout(id));
      tiles().forEach((el) => {
        el.classList.remove("tc-blink", "tc-spark");
        el.style.removeProperty("--glance");
      });
    };
  }, [ref, active]);
}
/** How long the shut eye shows. */
const BLINK_MS = 120;
/** One twinkle (globals.css, tc-spark). */
const SPARK_MS = 2900; // 1.8 s, and the last of a gilded tile's three stars starts a second in

/** How far a pupil travels at full look, in the drawing's units: the same as a glance's (globals.css, .tc-pupil). */
const PUPIL_X = 5.5;
const PUPIL_Y = 4;

/**
 * While the pointer is over a word, its letters look at it. At most once a frame, each pupil's
 * place is written straight onto it (its `transform`, with no transition while it follows), and
 * taken off again when the pointer leaves, so the pupil eases back to where a glance or nothing
 * puts it (globals.css, .tc-pupil). Returns the handlers for the word's row; none when `active`
 * is false. Only a mouse has a pointer to follow: a phone never runs this.
 *
 * Why not custom properties on the tile (as this was first built, --gx / --gy): a custom property
 * is inherited, so every shape in all four of the letter's layers had its style worked out again
 * on each frame. Measured in headless WebKit with the pointer moving non-stop over a five-letter
 * word, the two taken in turn, three rounds: about 35% of a processor core that way, 23% this way,
 * 10% with the eyes off. What is left is the pupil being redrawn inside the letter's top layer
 * (the layer rule: only a layer of their own would end it). A pointer at rest costs nothing
 * either way.
 */
export function useGaze(ref: RefObject<HTMLElement | null>, active: boolean) {
  const frame = useRef(0);
  const at = useRef<{ x: number; y: number } | null>(null);
  const apply = useCallback(() => {
    frame.current = 0;
    const row = ref.current;
    const p = at.current;
    if (!row || !p) return;
    const tiles = Array.from(row.querySelectorAll<HTMLElement>("[data-tc]"));
    // every read before any write: a write between two reads makes the browser lay the page out again
    const rects = tiles.map((el) => el.getBoundingClientRect());
    tiles.forEach((el, i) => {
      const r = rects[i];
      const dx = p.x - (r.left + r.width / 2);
      const dy = p.y - (r.top + r.height * 0.3); // the eyes sit near the top of the box
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / (r.width * 0.6));
      const to = `translate(${((dx / d) * k * PUPIL_X).toFixed(2)}px, ${((dy / d) * k * PUPIL_Y).toFixed(2)}px)`;
      el.querySelectorAll<SVGElement>(".tc-pupil").forEach((pupil) => {
        pupil.style.transition = "none";
        pupil.style.transform = to;
      });
    });
  }, [ref]);
  const clear = useCallback(() => {
    at.current = null;
    ref.current?.querySelectorAll<SVGElement>(".tc-pupil").forEach((pupil) => {
      pupil.style.removeProperty("transition");
      pupil.style.removeProperty("transform");
    });
  }, [ref]);
  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);
  // a word that stops being watched (it went still, or off screen) lets go of the pointer
  useEffect(() => {
    if (!active) clear();
  }, [active, clear]);
  if (!active) return {};
  return {
    onPointerMove: (e: { clientX: number; clientY: number; pointerType?: string }) => {
      if (e.pointerType && e.pointerType !== "mouse") return; // a touch has no hover to follow
      at.current = { x: e.clientX, y: e.clientY };
      if (!frame.current) frame.current = window.requestAnimationFrame(apply);
    },
    onPointerLeave: clear,
  };
}

/**
 * A letter standing alone where it is the star (the roll sheet): the same blinks and glances as a
 * word, off a timer of its own. Not for grids: one timer a letter is what a word avoids.
 */
export function TileSolo(props: TileCharacterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onScreen = useOnScreen(ref, !props.still);
  const state = props.state ?? "idle";
  useWordLife(ref, !props.still && !reduced && onScreen && (state === "idle" || state === "peckish"));
  return (
    <div ref={ref} className="inline-flex">
      <TileCharacter {...props} />
    </div>
  );
}

// ===========================================================================
// TileWord — a word as a row of TileCharacters holding hands.
// Full-size tiles overlap so each pair's hands meet between them (PITCH, the clasp).
// ===========================================================================
export function TileWord({
  word,
  upper,
  state = "idle",
  gild = 0,
  size = 64,
  detail = "auto",
  className = "",
  tier: rarity,
  still,
  states,
  gilds,
  look,
}: {
  word: string;
  upper: boolean[];
  state?: TileState;
  gild?: Gild;
  size?: number;
  detail?: TileDetail;
  className?: string;
  /**
   * The word's rarity, worn as its tiles' material (lib/rarityFinish). A COLLAB word wears its
   * set's two colors in place of it (decisions.md, "Collab sets"): the look is the word's, so it
   * is looked up here by the word, and no caller has to know. Only for a word drawn WITH its
   * rarity: an example word (no `tier`) is never dressed as a set's.
   */
  tier?: TileTier;
  /** The word's collab look, when the caller already holds it (a page outside the game); `null` for none. */
  look?: CollabLook | null;
  /** The finish without its motion. */
  still?: boolean;
  /**
   * A state or a stage for single letters, where one is given: letter i takes `states[i]` and
   * `gilds[i]`, and the rest keep `state` and `gild`. For a change that passes along the word
   * letter by letter (the ascend sheet's result).
   */
  states?: readonly (TileState | undefined)[];
  gilds?: readonly (Gild | undefined)[];
}) {
  const mine = useCollabLook(word, look);
  const tier: TileTier | undefined = typeof rarity === "string" ? tileTierOf(rarity, mine) : rarity;
  const letters = [...word];
  const stateAt = (i: number) => states?.[i] ?? state;
  // the word blinks and glances only while every letter is at rest
  const calm = letters.every((_, i) => stateAt(i) === "idle" || stateAt(i) === "peckish");
  // full-size words show characters holding hands (arms meet between the tiles); smaller word
  // rows have no limbs, so they sit in a neat row with a small positive gap instead.
  const full = detail === "full" || (detail === "auto" && size >= 100);
  // a full-size word has its life (blinks, glances) and, if it has a finish, its moments, while
  // it's on screen: a word scrolled away, or a copy hidden at this width, holds still
  const row = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const alive = full && !still;
  const onScreen = useOnScreen(row, alive);
  const [moment, play] = useFinishMoment(tier, alive && onScreen && state !== "hungry" && !!finishFor(tier), word);
  useWordLife(row, alive && onScreen && !reduced && calm);
  return (
    <div
      ref={row}
      className={`flex items-end justify-center ${moment ? "rf-moment" : ""} ${className}`}
      style={full ? undefined : { gap: Math.max(2, Math.round(size * 0.08)) }}
      onPointerEnter={full ? play : undefined}
    >
      {letters.map((ch, i) => (
        <div key={i} style={full ? { marginLeft: i ? -size * LINK_OVERLAP : 0 } : undefined}>
          <TileCharacter
            char={ch}
            upper={upper[i] ?? false}
            state={stateAt(i)}
            gild={gilds?.[i] ?? gild}
            size={size}
            detail={detail}
            tier={tier}
            still={still}
            index={i}
            linkLeft={full && i > 0}
            linkRight={full && i < letters.length - 1}
            lean={full ? leanFor(word, i) : 0}
          />
        </div>
      ))}
    </div>
  );
}
