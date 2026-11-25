"use client";
/**
 * A word standing in its scene: the scene behind, the word's characters on the scene's floor line,
 * the scene's front layer (curtains, snow) over them, and an optional overlay on top (the Today
 * stage's speech bubble). A 16:9 box at any width; the share card draws the same scene
 * (scenes/layout.ts keeps the two in step).
 *
 * The scene shows how the word is doing (starl3xx, 2026-11-24: "the scenes themselves should get
 * visibly more grayscale when a word is peckish and hungry", and "a cool animated, opaque fog ...
 * in addition to the grayscale"). Peckish: the color drains halfway and a thin fog drifts in.
 * Hungry: nearly grey, and thick fog rolling over the scene and the word (under the bubble and the
 * arrows; globals.css, .scene-fog, says how the fog is built). Fed: the
 * scene in full color, clear. The characters keep their color: their faces already show the mood.
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TileCharacter, useFinishMoment, type Gild, type TileState } from "../game/TileCharacter";
import type { Tier } from "@/lib/economy";
import type { SceneId } from "@/lib/scenes";
import { SCENE_W, SceneBack, SceneFront } from "./SceneArt";
import { sceneLayout } from "./layout";

/** The app's scene shape. The share card keeps its own (1.91:1 for X, 3:2 for Farcaster). */
export const SCENE_ASPECT = 16 / 9;
/** The scene height, in scene units, that fills a 16:9 box. */
const SCENE_H = Math.round(SCENE_W / SCENE_ASPECT);

export type SceneTone = "fed" | "peckish" | "hungry";
const TONE_CLASS: Record<SceneTone, string> = { fed: "", peckish: "scene-peckish", hungry: "scene-hungry" };

/** The scene's tone from the characters' state, so the two always agree (a word eating is fed). */
export function toneOf(state: TileState): SceneTone {
  return state === "hungry" ? "hungry" : state === "peckish" ? "peckish" : "fed";
}

/**
 * A React id made safe inside `url(#…)`: React's ids carry punctuation (":r0:", or "«r0»" in newer
 * versions), so keep only letters, digits, underscores, and dashes, with a letter first.
 */
function svgId(reactId: string): string {
  return `s${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

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
}: {
  /**
   * The word's rarity, worn as its tiles' material (lib/rarityFinish, decisions.md #23). Only a
   * word's own scene passes it; the scene sheet and picker show scenes, not words.
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
  /** A sideways swipe across the scene: 1 for the next word (swiped left), -1 for the one before. */
  onSwipe?: (step: 1 | -1) => void;
  overlay?: ReactNode;
  className?: string;
}) {
  const uid = svgId(useId());
  // The word's row in percentages of the box (scenes/layout.ts at one pixel per scene unit), so it
  // draws on the first paint and on the server (the share page), with nothing measured first.
  const L = sceneLayout(word.length, SCENE_W, SCENE_H);
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(4)}%`;
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
  // the effect catches up: never draw a scene twice (same key, same gradient ids; Bugbot on #164).
  const was = wasState !== scene ? wasState : null;

  // Nothing moves where it can't be seen: while the frame is off screen its scene, its tiles, and
  // their finishes hold still (globals.css, .scene-offscreen), which keeps a long page cheap.
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
        style: { touchAction: "pan-y" as const },
      }
    : {};

  // The word's finish has its moments while the scene is animated and on screen, and the word isn't
  // hungry (a hungry word's shine is gone); pointing at the word plays one (TileCharacter's
  // useFinishMoment). One timer for the word, not one per tile.
  const [moment, play] = useFinishMoment(tier, animated && !offscreen && !!word && state !== "hungry", word);

  // The characters hold hands (each overlaps the last, as in TileWord), sized in percent of the row.
  const tiles = (
    <div className={`flex items-end ${moment ? "rf-moment" : ""}`} onPointerEnter={play}>
      {[...word].map((ch, i) => (
        <div key={i} style={{ width: pct(L.tileW, L.rowW), flexShrink: 0, marginLeft: i ? `-${pct(L.overlap, L.rowW)}` : 0 }}>
          <TileCharacter char={ch} upper={upper[i] ?? false} state={state} gild={gild} pose="link" size={L.tileW} detail="full" fluid tier={tier} index={i} still={!animated} />
        </div>
      ))}
    </div>
  );
  const layers = (id: SceneId, front: boolean, fade: string) => (
    <div key={`${front ? "front" : "back"}-${id}`} className={`absolute inset-0 ${toneClass} ${front ? "pointer-events-none" : ""} ${fade}`}>
      {front ? (
        <SceneFront id={id} h={SCENE_H} uid={`${uid}${id}`} animated={animated} className="h-full w-full" />
      ) : (
        <SceneBack id={id} h={SCENE_H} uid={`${uid}${id}`} animated={animated} className="h-full w-full" />
      )}
    </div>
  );

  return (
    <div ref={box} className={`relative aspect-[16/9] w-full overflow-hidden ${offscreen ? "scene-offscreen" : ""} ${className}`} {...swipe}>
      {was && layers(was, false, "")}
      {layers(scene, false, was ? "scene-fade-in" : "")}
      {word && (
        <div
          key={word}
          className={`absolute ${slide ? `scene-in-${slide}` : ""}`}
          style={{ left: pct(L.rowLeft, SCENE_W), width: pct(L.rowW, SCENE_W), bottom: pct(L.rowBottom, SCENE_H) }}
        >
          {onWord ? (
            // No tilt here (the word stands on a floor now): the spotlight finds it and the
            // letters hop in a wave (globals.css, .scene-word).
            <button
              onClick={() => {
                if (swiped.current) return void (swiped.current = false);
                onWord();
              }}
              aria-label={wordLabel}
              className="scene-word block w-full rounded-2xl"
            >
              {tiles}
            </button>
          ) : (
            tiles
          )}
        </div>
      )}
      {was && layers(was, true, "scene-fade-out")}
      {layers(scene, true, was ? "scene-fade-in" : "")}
      {/* the fog: over the whole scene and the word, under the bubble and arrows (globals.css) */}
      <div aria-hidden className={`scene-fog is-${tone} pointer-events-none absolute inset-0 overflow-hidden`}>
        <i className="scene-fog-haze" />
        <i className="scene-fog-bank scene-fog-1" />
        <i className="scene-fog-bank scene-fog-2" />
        <i className="scene-fog-bank scene-fog-3" />
      </div>
      {overlay}
    </div>
  );
}

/** How long a new scene takes to fade in over the old one (globals.css, .scene-fade-in). */
const SCENE_FADE_MS = 450;

/** A still thumbnail of a scene, for the picker. */
export function SceneThumb({ scene, className = "" }: { scene: SceneId; className?: string }) {
  const uid = svgId(useId());
  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden ${className}`}>
      <SceneBack id={scene} h={SCENE_H} uid={uid} className="absolute inset-0 h-full w-full" />
      <SceneFront id={scene} h={SCENE_H} uid={uid} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
