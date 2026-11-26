"use client";
/**
 * The front of a word's card (decisions.md #33): the card's own paper, the scene's art in the
 * frame's window, the word's characters standing in it, the frame in the rarity's ink, and a ribbon
 * set into the frame's lower edge ("one of one", the card's number, the rarity). A 16:9 box at any
 * width; the share picture draws the same card (scenes/layout.ts and lib/cardArt keep the two in
 * step).
 *
 * - **The art and the frame are two still pictures,** each shown as a background image
 *   (lib/cardArt): no shapes in the page, nothing to redraw. A scene never moves. What moves is the
 *   card itself, where it is in focus (cards/SceneCard: a faint band of light, a lean toward the
 *   pointer), and the letters, as ever.
 * - **Nothing is drawn over the art but the letters.** A host's overlay (the Today stage's bubble
 *   and arrows) goes on top of everything.
 * - **The scene shows how the word is doing** (starl3xx, 2026-11-24: "the scenes themselves should
 *   get visibly more grayscale when a word is peckish and hungry", and "a cool animated, opaque fog
 *   ... in addition to the grayscale"). Peckish: the color drains halfway and a thin fog drifts in.
 *   Hungry: nearly grey, and thick fog rolling over the scene and the word (globals.css, .scene-fog).
 *   Both stay inside the window: the card keeps its paper and its ink. The characters keep their
 *   color: their faces already show the mood.
 * - **Words are only ever set in Söhne** (starl3xx, 2026-11-25): the ribbon letters what the card
 *   says about the word, in the card's serif (Iowan Old Style where the device has it), and never
 *   the word itself.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TileCharacter, leanFor, useFinishMoment, useGaze, usePrefersReducedMotion, useWordLife, type Gild, type TileState } from "../game/TileCharacter";
import { TierMark } from "../game/TierMark";
import type { Tier } from "@/lib/economy";
import type { SceneId } from "@/lib/scenes";
import { cardNo } from "@/lib/cardFacts";
import { CARD_H, CARD_W, svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_LOOKS } from "@/lib/cardArt/looks";
import { cardArt, cardFrame } from "@/lib/cardArt/scenes";
import { FOOT_SHARE, wordFootings, wordLayout } from "./layout";

/** The card's shape. The share picture sets the same card on a table (1.91:1 for X, 3:2 for Farcaster). */
export const SCENE_ASPECT = CARD_W / CARD_H;

export type SceneTone = "fed" | "peckish" | "hungry";
const TONE_CLASS: Record<SceneTone, string> = { fed: "", peckish: "scene-peckish", hungry: "scene-hungry" };

/** The scene's tone from the characters' state, so the two always agree (a word eating is fed). */
export function toneOf(state: TileState): SceneTone {
  return state === "hungry" ? "hungry" : state === "peckish" ? "peckish" : "fed";
}

// Each picture is built once for the page and then only named: `url("data:…")`, ready for CSS.
const pictures = new Map<string, string>();
function picture(key: string, make: () => string): string {
  let url = pictures.get(key);
  if (!url) pictures.set(key, (url = `url("${svgDataUri(svgDoc(make()))}")`));
  return url;
}
/** A scene's art as a CSS image. Only the stock card's art takes the rarity. */
export function sceneArtImage(scene: SceneId, tier: Tier): string {
  return picture(`art-${scene}-${scene === "stock" ? tier : ""}`, () => cardArt(scene, tier));
}
/** The frame for a rarity as a CSS image. */
export function cardFrameImage(tier: Tier): string {
  return picture(`frame-${tier}`, () => cardFrame(tier));
}

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(4)}%`;
/** A card with no word's rarity to wear (a scene's thumbnail, the empty stage) is printed as Common. */
const PLAIN: Tier = "Common";

export function SceneFrame({
  scene,
  word,
  upper,
  state = "idle",
  gild = 0,
  tone = "fed",
  animated = true,
  enter = null,
  onWord,
  wordLabel,
  onSwipe,
  overlay,
  className = "",
  tier,
  number,
  small = false,
}: {
  /**
   * The word's rarity: its tiles' material (lib/rarityFinish, decisions.md #23), the ink of the
   * card's frame, and the stock card's overtone. A card with none is printed as Common, with no
   * ribbon (it says nothing about a word).
   */
  tier?: Tier;
  scene: SceneId;
  word: string;
  upper: boolean[];
  state?: TileState;
  gild?: Gild;
  /**
   * How the word is doing: the scene greys and fogs as it gets hungry (pass toneOf(state)). Left
   * "fed" on purpose where the player is choosing a scene (the scene sheet): they need to see it.
   */
  tone?: SceneTone;
  animated?: boolean;
  /** When the word changes, the new one slides in from this side (the Today stage's arrows). */
  enter?: "next" | "prev" | null;
  /** Tapping the word (the Today stage opens its sheet). */
  onWord?: () => void;
  wordLabel?: string;
  /** A sideways swipe across the card: 1 for the next word (swiped left), -1 for the one before. */
  onSwipe?: (step: 1 | -1) => void;
  overlay?: ReactNode;
  className?: string;
  /** The card's number (cards/useCardNumber). Unknown: the ribbon leaves it out. */
  number?: number | null;
  /** A thumbnail (the Bag's grid, the scene picker): no ribbon. The frame's corners say the rarity. */
  small?: boolean;
}) {
  const ribbonId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const look = CARD_LOOKS[tier ?? PLAIN];
  // The word's row in percent of the card, so it draws on the first paint and on the server (the
  // share page), with nothing measured first.
  const L = wordLayout(word.length);
  const footings = wordFootings(scene, word.length);
  const toneClass = `scene-tone ${TONE_CLASS[tone]}`;

  // The side a new word slides in from, as it was when the word changed: `enter` can change later
  // without the word changing (a meal ends and the same word stays on stage), and that must not
  // replay the slide on the word already shown.
  const [entered, setEntered] = useState<{ word: string; enter: typeof enter }>({ word, enter: null });
  if (entered.word !== word) setEntered({ word, enter });
  const slide = entered.word === word ? entered.enter : enter;

  // A new scene fades in over the old one (a pick in the scene sheet, or the next word's home).
  const [wasState, setWas] = useState<SceneId | null>(null);
  const last = useRef(scene);
  useEffect(() => {
    if (last.current === scene) return;
    setWas(last.current);
    last.current = scene;
    const id = window.setTimeout(() => setWas(null), SCENE_FADE_MS);
    return () => window.clearTimeout(id);
  }, [scene]);
  // Flipping A → B → A inside the fade renders once with the old scene equal to the new one, before
  // the effect catches up: never draw a scene twice (same key; Bugbot on #164).
  const was = wasState !== scene ? wasState : null;

  // Nothing moves where it can't be seen: while the card is off screen its tiles and their finishes
  // hold still (globals.css, .scene-offscreen), which keeps a long page cheap.
  const box = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!animated || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  // Swipe: a mostly sideways drag of 48 px or more. The tap that ends a swipe doesn't open the word.
  const down = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const swipe = onSwipe
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
          down.current = { x: e.clientX, y: e.clientY };
          swiped.current = false;
        },
        onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
          const d = down.current;
          down.current = null;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            swiped.current = true;
            onSwipe(dx < 0 ? 1 : -1);
          }
        },
      }
    : {};

  // The word's finish has its moments while the card is animated and on screen, and the word isn't
  // hungry (a hungry word's shine is gone); pointing at the word plays one (TileCharacter's
  // useFinishMoment). One timer for the word, not one per tile.
  const [moment, play] = useFinishMoment(tier, animated && !offscreen && !!word && state !== "hungry", word);

  // The word's life (blinks, glances) and, where it can be tapped, its eyes on the pointer, on the
  // same terms as its finish: animated, on screen, motion welcome (TileCharacter's useWordLife and
  // useGaze). One timer for the word.
  const reduced = usePrefersReducedMotion();
  const wordRow = useRef<HTMLDivElement>(null);
  const lively = animated && !offscreen && !!word && !reduced;
  useWordLife(wordRow, lively && (state === "idle" || state === "peckish"));
  const gaze = useGaze(wordRow, lively && !!onWord);

  // The characters hold hands (each overlaps the last, as in TileWord), sized in percent of the
  // row, each with its own small lean (leanFor: the same in the app, a still card, and a share).
  // Where the scene's ground is curved, each stands on the curve (layout.ts, wordFootings).
  const tiles = (
    <div ref={wordRow} className={`flex items-end ${moment ? "rf-moment" : ""}`} onPointerEnter={play} {...gaze}>
      {[...word].map((ch, i, all) => {
        const f = footings[i];
        const stand: CSSProperties | undefined =
          f.drop || f.deg ? { transform: `translateY(${((f.drop / CARD_W) * 100).toFixed(3)}cqw) rotate(${f.deg.toFixed(2)}deg)`, transformOrigin: `50% ${(FOOT_SHARE * 100).toFixed(2)}%` } : undefined;
        return (
          // display: flex, so no line box sits under the tile and the feet land on the line exactly
          <div key={i} style={{ display: "flex", width: pct(L.tileW, L.rowW), flexShrink: 0, marginLeft: i ? `-${pct(L.overlap, L.rowW)}` : 0, ...stand }}>
            <TileCharacter
              char={ch}
              upper={upper[i] ?? false}
              state={state}
              gild={gild}
              linkLeft={i > 0}
              linkRight={i < all.length - 1}
              lean={leanFor(word, i)}
              size={L.tileW}
              detail="full"
              fluid
              tier={tier}
              index={i}
              still={!animated}
            />
          </div>
        );
      })}
    </div>
  );
  // The art's text is worked out from sines and cosines, which the server and a browser may round
  // one digit apart; either picture is right, so a mismatch on hydration is let be.
  const art = (id: SceneId, fade: string) => (
    <div key={`art-${id}`} className={`cf-art ${toneClass} ${fade}`} style={{ backgroundImage: sceneArtImage(id, tier ?? PLAIN) }} suppressHydrationWarning />
  );
  const no = cardNo(number);
  // A ribbon's folded tail, drawn (not clipped out of a box), so its notch has the ink line too.
  const tail = (side: "l" | "r") => (
    <svg aria-hidden className={`cf-tail cf-tail-${side}`} viewBox="0 0 30 40" preserveAspectRatio="none">
      <pattern id={`${ribbonId}${side}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={`rotate(${side === "l" ? 55 : -55})`}>
        <line x1="0" y1="2" x2="4" y2="2" stroke={look.ink} strokeWidth="1" strokeOpacity="0.3" />
      </pattern>
      <polygon points={side === "l" ? "0,0 30,0 30,40 0,40 11,20" : "0,0 30,0 19,20 30,40 0,40"} />
      <polygon className="cf-tail-shade" points={side === "l" ? "0,0 30,0 30,40 0,40 11,20" : "0,0 30,0 19,20 30,40 0,40"} style={{ fill: `url(#${ribbonId}${side})` }} />
    </svg>
  );

  return (
    <div
      ref={box}
      className={`cf ${small ? "cf-small" : ""} ${offscreen ? "scene-offscreen" : ""} ${animated ? "" : "scene-still"} ${className}`}
      style={{ "--cf-ink": look.ink, "--cf-accent": look.accent, "--cf-ground": look.ground, ...(onSwipe ? { touchAction: "pan-y" } : {}) } as CSSProperties}
      {...swipe}
    >
      {was && art(was, "")}
      {art(scene, was ? "scene-fade-in" : "")}
      <div className="cf-frame" style={{ backgroundImage: cardFrameImage(tier ?? PLAIN) }} suppressHydrationWarning />
      <div className="cf-tex" />
      {word && (
        <div
          key={word}
          className={`cf-word ${slide ? `scene-in-${slide}` : ""}`}
          style={{ left: pct(L.rowLeft, CARD_W), width: pct(L.rowW, CARD_W), bottom: pct(CARD_H - L.rowBottom, CARD_H) }}
        >
          {onWord ? (
            // The word notices the pointer: its letters rise onto their toes in turn and look at it,
            // and a press squashes them (globals.css, .tc-perks). Feet and held hands stay put.
            <button
              onClick={() => {
                if (swiped.current) return void (swiped.current = false);
                onWord();
              }}
              aria-label={wordLabel}
              className="tc-perks block w-full rounded-2xl"
            >
              {tiles}
            </button>
          ) : (
            tiles
          )}
        </div>
      )}
      {/* the fog: inside the window, over the scene and the word, under the ribbon (globals.css) */}
      <div aria-hidden className={`cf-fog scene-fog is-${tone}`}>
        <i className="scene-fog-haze" />
        <i className="scene-fog-bank scene-fog-1" />
        <i className="scene-fog-bank scene-fog-2" />
        <i className="scene-fog-bank scene-fog-3" />
      </div>
      {/* The ribbon, set into the frame's lower edge: "one of one", the number, the rarity, in that
          order (starl3xx, 2026-11-25). A phone-sized card drops "one of one" (globals.css). The
          word itself is never lettered here. */}
      {tier && !small && (
        <div className="cf-ribbon">
          {tail("l")}
          {tail("r")}
          <div className="cf-ribbon-in">
            <span className="cf-oneof cf-caps">One of one</span>
            <i aria-hidden className="cf-oneof" />
            {no && (
              <>
                <span className="cf-caps">{no}</span>
                <i aria-hidden />
              </>
            )}
            <span className="cf-rarity">
              <TierMark tier={tier} className="cf-mark" />
              <span className="cf-caps">{tier}</span>
            </span>
          </div>
        </div>
      )}
      {overlay}
    </div>
  );
}

/** How long a new scene takes to fade in over the old one (globals.css, .scene-fade-in). */
const SCENE_FADE_MS = 450;

/** A still thumbnail of a scene, for the picker: the art in the frame, no word. The stock card
 *  shows in the rarity of the word being dressed. */
export function SceneThumb({ scene, tier = PLAIN, className = "" }: { scene: SceneId; tier?: Tier; className?: string }) {
  return (
    <div className={`cf cf-small ${className}`}>
      <div className="cf-art" style={{ backgroundImage: sceneArtImage(scene, tier) }} suppressHydrationWarning />
      <div className="cf-frame" style={{ backgroundImage: cardFrameImage(tier) }} suppressHydrationWarning />
      <div className="cf-tex" />
    </div>
  );
}
