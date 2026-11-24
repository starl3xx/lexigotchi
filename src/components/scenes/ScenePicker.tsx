"use client";
/**
 * Pick a word's scene: every scene as a still thumbnail, the word's own one marked, and the locked
 * ones shown with what opens them (lib/scenes: own SCENE_UNLOCK_WORDS words). Used by the scene
 * sheet (from the Today stage) and the Showcase.
 */
import { SCENES, canUseScene } from "@/lib/scenes";
import { Lock } from "../game/ui/icons";
import { SceneThumb } from "./SceneFrame";
import { useSceneUnlock, useWordScene } from "./useWordScene";

export function ScenePicker({ word }: { word: string }) {
  const { scene, set } = useWordScene(word);
  const { unlocked, count, need } = useSceneUnlock();
  return (
    <div className="space-y-2">
      {!unlocked && (
        <p className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink/30 px-3 py-2 text-center text-sm text-ink/70">
          <Lock weight="fill" className="shrink-0" />
          <span>
            Own {need} words to unlock every scene for good. You’re at {count}.
          </span>
        </p>
      )}
      <div role="radiogroup" aria-label={`${word}’s scene`} className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {SCENES.map((s) => {
          const open = canUseScene(s.id, count);
          const on = scene === s.id;
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={on}
              disabled={!open}
              title={open ? s.blurb : `Own ${need} words to unlock`}
              onClick={() => set(s.id)}
              className={`cel-sm press relative flex flex-col gap-1 rounded-xl p-1 text-left disabled:cursor-not-allowed ${on ? "bg-ink text-paper" : "bg-card"}`}
            >
              <span className={`block overflow-hidden rounded-lg border-2 border-ink ${open ? "" : "opacity-45 grayscale"}`}>
                <SceneThumb scene={s.id} />
              </span>
              <span className="flex items-center gap-1 truncate px-0.5 text-xs font-bold">
                {!open && <Lock weight="fill" size={11} className="shrink-0" aria-label="locked" />}
                {s.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
