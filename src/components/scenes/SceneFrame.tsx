"use client";
/**
 * The front of a word's card (decisions.md #34): the card's own paper, the scene's art in the
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
 * - **The face shows how the word is doing: its ink runs low** (decisions.md #61; starl3xx,
 *   2026-11-27: "19B!"). Peckish: the art is printed a little fainter and loses some color.
 *   Hungry: most of the way to bare paper. Only the art takes it (globals.css, .scene-tone): the
 *   frame and the ribbon keep their ink, and the characters keep their color, since their faces
 *   already show the mood. Nothing is laid over the card for it: the fog that used to roll over
 *   the scene and the word is gone ("fog doesn't feel right anymore").
 * - **Words are only ever set in Söhne** (starl3xx, 2026-11-25): the ribbon letters what the card
 *   says about the word, in the card's serif (Source Serif 4, shipped with the game), and never
 *   the word itself.
 */
import { useContext, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TileCharacter, leanFor, useFinishMoment, useGaze, usePrefersReducedMotion, useWordLife, type Gild, type TileState } from "../game/TileCharacter";
import { TierMark } from "../game/TierMark";
import type { Tier } from "@/lib/economy";
import { swapSide, type SceneId } from "@/lib/scenes";
import { cardNo } from "@/lib/cardFacts";
import { CARD_H, CARD_W, svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_LOOKS, type CardLook } from "@/lib/cardArt/looks";
import { collabCardLook, type CollabLook } from "@/lib/collabLook";
import { tileTierOf, useCollabLook } from "../game/collabLooksContext";
import { DARK_SCENES, PALE_SCENES, RARITY_FACES, cardArt, cardFrame } from "@/lib/cardArt/scenes";
import { LIGHT_INK, lightLines, type LightInk } from "@/lib/cardArt/light";
import { CardLit } from "./cardLit";
import { useLinesBitmap } from "./useLinesBitmap";
import { FOOT_SHARE, wordFootings, wordLayout } from "./layout";

/** The card's shape. The share picture sets the same card on a table (1.91:1 for X, 3:2 for Farcaster). */
export const SCENE_ASPECT = CARD_W / CARD_H;

export type SceneTone = "fed" | "peckish" | "hungry";
const TONE_CLASS: Record<SceneTone, string> = { fed: "", peckish: "scene-peckish", hungry: "scene-hungry" };

/** The scene's tone from the characters' state, so the two always agree (a word just woken is awake). */
export function toneOf(state: TileState): SceneTone {
  return state === "hungry" ? "hungry" : state === "peckish" ? "peckish" : "fed";
}

// Each picture is built once for the page and then only named: `url("data:…")`, ready for CSS.
const pictures = new Map<string, string>();
function picture(key: string, make: () => string): string {
  let url = pictures.get(key);
  if (!url) {
    // Bounded: the rarities and scenes make a few dozen pictures, but a collab look is any two
    // colors, and the admin's preview makes a new look for every step of a color picker.
    if (pictures.size > 120) pictures.clear();
    pictures.set(key, (url = `url("${svgDataUri(svgDoc(make()))}")`));
  }
  return url;
}
/** A collab look's own key for the pictures kept here: its two colors (the stamp is not in these pictures). */
const lookKey = (look: CollabLook | undefined) => (look ? `${look.a}${look.b}` : "");
/** A collab word's card look in place of its rarity's, or undefined for any other word. */
const cardLookOf = (look: CollabLook | undefined): (CardLook & { tint2?: string }) | undefined => (look ? collabCardLook(look) : undefined);

/** A face's art as a CSS image, kept per rarity (and per collab look) for the faces that are printed in it (RARITY_FACES). */
export function sceneArtImage(scene: SceneId, tier: Tier, look?: CollabLook): string {
  return picture(`art-${scene}-${RARITY_FACES.has(scene) ? tier + lookKey(look) : ""}`, () => cardArt(scene, tier, cardLookOf(look)));
}
/** The card's light as a CSS image (lib/cardArt/light): the ruled lines a passing band shows, in one of three inks. */
export function cardLightImage(ink: LightInk): string {
  return picture(`light-${ink}`, () => lightLines(ink));
}
/** The frame for a rarity as a CSS image: in a collab word's own ink when it has a look. */
export function cardFrameImage(tier: Tier, look?: CollabLook): string {
  return picture(`frame-${tier}${lookKey(look)}`, () => cardFrame(tier, cardLookOf(look)));
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
  collab,
  change = "fade",
  states,
  armsUp = false,
  moments,
}: {
  /**
   * A state for single letters, as TileWord takes: letter i wears `states[i]`, the rest `state`.
   * For a change that passes along the word a letter at a time (a wake: components/game/wake).
   */
  states?: readonly (TileState | undefined)[];
  /** A curtain call: the word's joined hands raised (TileCharacter, `armsUp`). */
  armsUp?: boolean;
  /** A class for the box around each letter, for a moment (globals.css: wk-rise, wk-bow, tc-blink). */
  moments?: readonly (string | undefined)[];
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
   * How the word is doing: the face's ink runs low as it gets hungry (pass toneOf(state)). Left
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
  /**
   * The word's collab look, when the caller already holds it (the share page, outside the game);
   * `null` for a card that is no word of a set. Otherwise it is looked up by the word.
   */
  collab?: CollabLook | null;
  /**
   * How a new face takes the old one's place. "fade": it fades in over it (the Today stage's next
   * word, a pick made behind a sheet). "slide": it slides in over it from the side it sits on in
   * the face picker, where the player is switching faces and watching this card (decisions.md
   * #59). Under reduced motion both are the fade.
   */
  change?: "fade" | "slide";
}) {
  const ribbonId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  // A collab word's card is the collab stock in its set's two colors, with the set's stamp
  // (decisions.md, "Collab sets"): its look takes the place of its rarity's on the frame, the
  // stock card's wash, the ribbon, and the tiles. Its rarity (Legendary) still names the ribbon.
  const mine = useCollabLook(word, collab);
  const look = cardLookOf(mine) ?? CARD_LOOKS[tier ?? PLAIN];
  // The card's light (./cardLit): only the card in focus has one. Its ink is the rarity's, or the
  // plain white for a collab word, whose card is its set's colors and no metal.
  const lit = useContext(CardLit);
  const lightInk: LightInk = mine ? "white" : LIGHT_INK[tier ?? PLAIN];
  // Its lines are kept as a bitmap while the card is lit: the pointer moves the band, and a
  // vector picture is drawn again on every frame it moves (./useLinesBitmap).
  const lines = useRef<HTMLElement>(null);
  const linesPicture = cardLightImage(lightInk);
  const linesBitmap = useLinesBitmap(lines, linesPicture, lit);
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

  // A new face comes in over the old one (a pick in the face sheet, or the next word's home): the
  // old one stays underneath until the new one is in. Which face was showing is worked out WHILE
  // rendering, never in an effect: an effect is one render late, and that render has the new face
  // in place with nothing under it. If it reaches the screen, a slide starts with a jump.
  const [swap, setSwap] = useState<{ shown: SceneId; was: SceneId | null; side: "next" | "prev"; n: number }>({ shown: scene, was: null, side: "next", n: 0 });
  if (swap.shown !== scene) setSwap({ shown: scene, was: swap.shown, side: swapSide(swap.shown, scene), n: swap.n + 1 });
  useEffect(() => {
    if (swap.n === 0) return;
    // `n` names this change: a later change's old face is never cleared by this one's timer
    const id = window.setTimeout(() => setSwap((s) => (s.n === swap.n ? { ...s, was: null } : s)), SCENE_SWAP_MS);
    return () => window.clearTimeout(id);
  }, [swap.n]);
  // Flipping A → B → A inside the change would draw one face twice, as the old and the new: never
  // draw a face twice (same key; Bugbot on #164).
  const was = swap.was !== scene ? swap.was : null;
  const coming = was ? (change === "slide" ? `scene-slide-${swap.side}` : "scene-fade-in") : "";

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
  // the word blinks and glances only while every letter is at rest (as TileWord's does)
  const calm = [...word].every((_, i) => {
    const s = states?.[i] ?? state;
    return s === "idle" || s === "peckish";
  });
  useWordLife(wordRow, lively && calm);
  const gaze = useGaze(wordRow, lively && !!onWord);

  // The characters hold hands (each overlaps the last, as in TileWord), sized in percent of the
  // row, each with its own small lean (leanFor: the same in the app, a still card, and a share).
  // Where the scene's ground is curved, each stands on the curve (layout.ts, wordFootings).
  const tiles = (
    <div ref={wordRow} className={`flex items-end ${moment ? "rf-moment" : ""}`} onPointerEnter={play} {...gaze}>
      {[...word].map((ch, i, all) => {
        const f = footings[i];
        // A letter turns about its FEET, always: the turning point is set on level ground too,
        // where nothing turns. Set only with the turn, it was dropped the moment a word left a
        // curved face for a level one, and the letter swung about its middle for the length of
        // the glide (.cf-stand; Bugbot on #317).
        const stand: CSSProperties = {
          transformOrigin: `50% ${(FOOT_SHARE * 100).toFixed(2)}%`,
          ...(f.drop || f.deg ? { transform: `translateY(${((f.drop / CARD_W) * 100).toFixed(3)}cqw) rotate(${f.deg.toFixed(2)}deg)` } : {}),
        };
        return (
          // display: flex, so no line box sits under the tile and the feet land on the line exactly
          <div key={i} className={moments?.[i] ? `cf-stand ${moments[i]}` : "cf-stand"} style={{ display: "flex", width: pct(L.tileW, L.rowW), flexShrink: 0, marginLeft: i ? `-${pct(L.overlap, L.rowW)}` : 0, ...stand }}>
            <TileCharacter
              char={ch}
              upper={upper[i] ?? false}
              state={states?.[i] ?? state}
              gild={gild}
              armsUp={armsUp}
              linkLeft={i > 0}
              linkRight={i < all.length - 1}
              lean={leanFor(word, i)}
              size={L.tileW}
              detail="full"
              fluid
              tier={tileTierOf(tier, mine)}
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
    <div key={`art-${id}`} className={`cf-art ${fade}`} style={{ backgroundImage: sceneArtImage(id, tier ?? PLAIN, mine) }} suppressHydrationWarning />
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
      // `cf-changing`: only while a face change is in flight do the letters glide to their new
      // stances (globals.css, .cf-stand). A stance is written in units of the card's width, so a
      // glide that was always on also ran on every resize: the letters drifted for half a second.
      className={`cf ${small ? "cf-small" : ""} ${DARK_SCENES.has(scene) ? "cf-dark" : PALE_SCENES.has(scene) ? "cf-pale" : ""} ${was ? "cf-changing" : ""} ${offscreen ? "scene-offscreen" : ""} ${animated ? "" : "scene-still"} ${className}`}
      style={{ "--cf-ink": look.ink, "--cf-accent": look.accent, "--cf-ground": look.ground, ...(onSwipe ? { touchAction: "pan-y" } : {}) } as CSSProperties}
      {...swipe}
    >
      {/* The face's art, as ONE GROUP, and the group takes the hunger tone (globals.css, .scene-tone).
          During a face change the old picture stays under the new one until it is in. A hungry
          face is see-through, so with the tone on each picture the two added up to more ink than
          one, and the card popped paler when the old one was dropped (Bugbot on #328). As a group
          they are put together at full strength first, and then faded once. */}
      <div className={`cf-arts ${toneClass}`}>
        {was && art(was, "")}
        {art(scene, coming)}
      </div>
      <div className="cf-frame" style={{ backgroundImage: cardFrameImage(tier ?? PLAIN, mine) }} suppressHydrationWarning />
      <div className="cf-tex" />
      {/* The card's light (decisions.md #58, part 3): ruled lines that stand still on the card, shown
          through a band that crosses it in a moment (globals.css, .cf-light). Over the art, the
          frame, and the stock; UNDER the word, so no line ever crosses a letter. */}
      {lit && (
        <i aria-hidden className="cf-light">
          <i ref={lines} style={{ backgroundImage: linesBitmap ?? linesPicture }} />
        </i>
      )}
      {/* The set's stamp, in ONE fixed place on every collab card: the window's upper left, clear of
          the word, the ribbon, and the turn-over button. A picture the operator uploaded, served by
          this site (never an SVG). A thumbnail is too small for it (globals.css). */}
      {mine?.stamp && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cf-stamp" src={mine.stamp} alt="" draggable={false} />
      )}
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

/** How long a new face takes to come in over the old one (globals.css, .scene-fade-in and
 *  .scene-slide-*): the old face is kept underneath for this long, then dropped. */
const SCENE_SWAP_MS = 540;

/** A still thumbnail of a scene, for the picker: the art in the frame, no word. The stock card
 *  shows in the rarity of the word being dressed. */
export function SceneThumb({ scene, tier = PLAIN, className = "", word }: { scene: SceneId; tier?: Tier; className?: string; /** the word being dressed: a collab word's thumbnails are in its own look */ word?: string }) {
  const mine = useCollabLook(word);
  return (
    <div className={`cf cf-small ${className}`}>
      <div className="cf-art" style={{ backgroundImage: sceneArtImage(scene, tier, mine) }} suppressHydrationWarning />
      <div className="cf-frame" style={{ backgroundImage: cardFrameImage(tier, mine) }} suppressHydrationWarning />
      <div className="cf-tex" />
    </div>
  );
}
