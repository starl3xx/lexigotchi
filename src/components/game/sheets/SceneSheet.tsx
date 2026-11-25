"use client";
/**
 * A word's scene, picked from the Today stage: the word standing in its scene at the top, the
 * scenes to choose from underneath. A pick applies at once (and to the word's card and its share
 * picture, which read the same saved choice). Opened from the word's own sheet (`fromWord`), closing
 * it goes back to the word.
 */
import { Button, Sheet } from "../primitives";
import { careState } from "../LetterTile";
import { useGame } from "../state";
import type { Gild } from "../TileCharacter";
import { SceneFrame } from "../../scenes/SceneFrame";
import { ScenePicker } from "../../scenes/ScenePicker";
import { useWordScene } from "../../scenes/useWordScene";
import { sceneMeta } from "@/lib/scenes";

export function SceneSheet({ word, fromWord = false }: { word: string; fromWord?: boolean }) {
  const g = useGame();
  const w = g.state.words.find((x) => x.word === word);
  const { scene } = useWordScene(word);
  if (!w) return null;
  const close = fromWord ? () => g.openSheet({ kind: "word", word }) : g.closeSheet;
  const gild = Math.max(0, Math.min(5, Math.round(w.prestigeLevel))) as Gild; // 5 = Holographic
  return (
    <Sheet open onClose={close} title={`${word}’s scene`}>
      <div className="space-y-3 pb-2">
        <SceneFrame
          scene={scene}
          word={w.word}
          upper={w.upper}
          state={careState(w)}
          // No hunger tone here on purpose: the player is choosing a scene and needs to see it
          // clear, not grey and fogged (the Today stage behind the sheet still shows the mood).
          gild={gild}
          tier={w.tier}
          className="rounded-xl border-[3px] border-ink"
        />
        <p className="text-center text-sm text-ink/70">
          <strong className="text-ink">{sceneMeta(scene).name}.</strong> {sceneMeta(scene).blurb}
        </p>
        <ScenePicker word={w.word} />
        <Button variant="ghost" full onClick={close}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
