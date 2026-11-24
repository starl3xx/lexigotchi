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
import { TileWord, type Gild, type TileState } from "../game/TileCharacter";
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
}: {
  scene: SceneId;
  word: string;
  upper: boolean[];
  state?: TileState;
  gild?: Gild;
  /** How the word is doing: the scene greys as it gets hungry. */
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
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = W > 0 ? sceneLayout(word.length, W, W / SCENE_ASPECT) : null;
  const toneClass = `scene-tone ${TONE_CLASS[tone]}`;

  // A new scene fades in over the old one (a pick in the scene sheet, or the next word's home).
  const [was, setWas] = useState<SceneId | null>(null);
  const last = useRef(scene);
  useEffect(() => {
    if (last.current === scene) return;
    setWas(last.current);
    last.current = scene;
    const id = window.setTimeout(() => setWas(null), SCENE_FADE_MS);
    return () => window.clearTimeout(id);
  }, [scene]);

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

  const tiles = layout && (
    <TileWord word={word} upper={upper} state={state} gild={gild} size={layout.tileW} detail="full" />
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
    <div ref={box} className={`relative aspect-[16/9] w-full overflow-hidden ${className}`} {...swipe}>
      {was && layers(was, false, "")}
      {layers(scene, false, was ? "scene-fade-in" : "")}
      {layout && (
        <div
          key={word}
          className={`absolute inset-x-0 flex justify-center ${enter ? `scene-in-${enter}` : ""}`}
          style={{ bottom: layout.rowBottom }}
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
              className="scene-word rounded-2xl"
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
