"use client";
/**
 * A word's scene, picked from the Today stage: the word standing in its scene at the top, the
 * scenes to choose from underneath. A pick applies at once (and to the Showcase, which reads the
 * same saved choice).
 */
import { Button, Sheet } from "../primitives";
import { careState } from "../LetterTile";
import { useGame } from "../state";
import type { Gild } from "../TileCharacter";
import { SceneFrame } from "../../scenes/SceneFrame";
import { ScenePicker } from "../../scenes/ScenePicker";
import { useWordScene } from "../../scenes/useWordScene";
import { sceneMeta } from "@/lib/scenes";

export function SceneSheet({ word }: { word: string }) {
  const g = useGame();
  const w = g.state.words.find((x) => x.word === word);
  const { scene } = useWordScene(word);
  if (!w) return null;
  const gild = Math.max(0, Math.min(4, Math.round(w.prestigeLevel))) as Gild;
  return (
    <Sheet open onClose={g.closeSheet} title={`${word}’s scene`}>
      <div className="space-y-3 pb-2">
        <SceneFrame
          scene={scene}
          word={w.word}
          upper={w.upper}
          state={careState(w)}
          gild={gild}
          className="rounded-xl border-[3px] border-ink"
        />
        <p className="text-center text-sm text-ink/70">
          <strong className="text-ink">{sceneMeta(scene).name}.</strong> {sceneMeta(scene).blurb}
        </p>
        <ScenePicker word={w.word} />
        <Button variant="ghost" full onClick={g.closeSheet}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
