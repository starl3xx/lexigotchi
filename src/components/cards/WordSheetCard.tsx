"use client";
/**
 * The opened word's card, at the top of its sheet: the word in its scene, in focus (so it moves:
 * the scene, the bounce, the finish's moments), turned over with the button in its corner. Under it,
 * the Showcase's two jobs, folded in (starl3xx, 2026-11-25: "fold showcase into the bag"): pick the
 * word's scene, and share it.
 */
import { useState } from "react";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { useWordScene } from "../scenes/useWordScene";
import type { Gild } from "../game/TileCharacter";
import { careState } from "../game/LetterTile";
import { Button } from "../game/primitives";
import { DownloadSimple, Palette, ShareNetwork, XLogo } from "../game/ui/icons";
import { useGame, type OwnedWord } from "../game/state";
import { usePostToX, useSaveImage, useShare } from "../game/useShare";
import { showcaseCardPath, showcasePostText, showcaseUrl, showcaseWordText, showcaseXText } from "@/lib/showcase";
import { SceneCard } from "./SceneCard";
import { CardMore } from "./CardBack";
import { ShareVideo } from "./ShareVideo";

export function WordSheetCard({ word, eating }: { word: OwnedWord; eating: boolean }) {
  const g = useGame();
  const { scene } = useWordScene(word.word);
  const [back, setBack] = useState(false);
  const [sharing, setSharing] = useState(false);
  const face = eating ? "eating" : careState(word);
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  return (
    // the card's width decides, by container query, whether the rows a phone-sized back leaves out
    // are listed under it (CardMore)
    <div className="sc-more-host mb-3 space-y-2">
      <SceneCard
        word={word}
        framed
        flipped={back}
        onFlip={setBack}
        front={<SceneFrame scene={scene} word={word.word} upper={word.upper} state={face} tone={toneOf(face)} gild={gild} tier={word.tier} animated={!back} />}
      />
      {back && <CardMore word={word} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => g.openSheet({ kind: "scene", word: word.word, fromWord: true })}>
          <Palette weight="fill" /> Scene
        </Button>
        <Button variant={sharing ? "primary" : "ghost"} aria-expanded={sharing} onClick={() => setSharing((s) => !s)}>
          <ShareNetwork weight="fill" /> Share
        </Button>
      </div>
      {/* Mounted only when asked for: saving the picture fetches it ahead on phones. */}
      {sharing && <ShareWord word={word} />}
    </div>
  );
}

/**
 * Share the word in its scene: X first, Farcaster second (lib/showcase), or keep the picture. The
 * link's card draws the word in this scene; a saved picture carries the game's name in a corner.
 */
function ShareWord({ word }: { word: OwnedWord }) {
  const share = useShare();
  const postToX = usePostToX();
  const { scene } = useWordScene(word.word);
  const text = showcaseWordText(word.word, word.upper);
  const saveImage = useSaveImage(showcaseCardPath(text, "x", scene, true), `lexigotchi-${word.word.toLowerCase()}-${scene}.png`);
  return (
    <div className="space-y-2 rounded-2xl border-2 border-ink bg-card p-2.5">
      <Button full variant="primary" onClick={() => postToX({ text: showcaseXText(text), url: showcaseUrl(text, scene) })}>
        <XLogo weight="bold" /> Post {word.word} on X
      </Button>
      {/* X's composer shows no card for a link it hasn't read yet, and each new word or scene is a
          new link: the card comes once X has read it (tested 2026-11-24, even with a fast image). */}
      <p className="text-center text-xs text-ink/55">X adds the picture once it reads the link.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => share({ text: showcasePostText(text), embed: showcaseUrl(text, scene) })}>
          <ShareNetwork weight="fill" /> Cast
        </Button>
        <Button variant="ghost" onClick={() => void saveImage()}>
          <DownloadSimple weight="bold" /> Save image
        </Button>
      </div>
      {/* the card turning over, as a video to post or keep (made only when asked: ./ShareVideo) */}
      <ShareVideo word={word} text={text} scene={scene} />
    </div>
  );
}
