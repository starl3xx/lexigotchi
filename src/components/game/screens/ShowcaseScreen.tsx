"use client";
/**
 * Showcase: one of your own words, standing in its scene, shared on X or Farcaster. Only words in
 * the player's bag (linked wallets' words too), never free text (starl3xx, 2026-11-24: "Showcase
 * should only be for words you own"); the share page draws only dictionary words besides
 * (lib/showcase). X first, Farcaster second: each share links to /s/<word>?scene=…, whose card
 * draws the word in that scene, so the post shows the word instead of the generic logo.
 */
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button, EmptyState, SectionTitle } from "../primitives";
import { WordTiles } from "../LetterTile";
import type { Gild } from "../TileCharacter";
import { ShareNetwork, TextAa, XLogo } from "../ui/icons";
import { useGame } from "../state";
import { byBest } from "../stagePick";
import { usePostToX, useShare } from "../useShare";
import { SceneFrame } from "../../scenes/SceneFrame";
import { ScenePicker } from "../../scenes/ScenePicker";
import { useWordScene } from "../../scenes/useWordScene";
import { showcasePostText, showcaseUrl, showcaseWordText, showcaseXText } from "@/lib/showcase";
import { ACHIEVEMENT_META } from "@/lib/keeper/achievements";
import { usePlayerWallets } from "../usePlayerWallets";
import { WordsPending, wordsUnknown } from "../WordsPending";

export function ShowcaseScreen() {
  const g = useGame();
  const { state } = g;
  const share = useShare();
  const postToX = usePostToX();
  const { address } = useAccount();
  // On-chain badges (EAS attestations for the whole bag). Empty is a fine answer; the section
  // hides until something is earned.
  const [badges, setBadges] = useState<{ achievement: number; value: number }[]>([]);
  const playerWallets = usePlayerWallets();
  useEffect(() => {
    if (!state.chainBacked || !address) return;
    const bag = playerWallets; // every wallet of this player: Farcaster's and the profile's
    let dead = false;
    void fetch(`/api/achievements?wallets=${bag.join(",")}`)
      .then((r) => r.json())
      .then((d) => {
        if (!dead && d?.ok) setBadges(d.achievements);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [state.chainBacked, address, playerWallets]);

  // The player's words, best first; the Showcase opens on the best one.
  const words = [...state.words].sort(byBest);
  const [picked, setPicked] = useState<string | null>(null);
  const w = words.find((x) => x.word === picked) ?? words[0];
  const { scene } = useWordScene(w?.word);

  const intro = (
    <div>
      <h1 className="font-display text-2xl font-extrabold md:hidden">Showcase</h1>
      <p className="text-sm text-ink/60">Show off a word you own. Pick a word and its scene, then share it.</p>
    </div>
  );

  if (!w) {
    // While the words are on their way, or their read failed, say so: "no words" would be wrong for
    // a returning player.
    return (
      <div className="space-y-3">
        {intro}
        {wordsUnknown(state) ? (
          <WordsPending />
        ) : (
          <>
            <EmptyState Icon={TextAa} title="No words to show yet" sub="Claim a word and it can star in your showcase." />
            <Button full variant="teal" onClick={() => g.nav("claim")}>
              Claim a word
            </Button>
          </>
        )}
      </div>
    );
  }

  const text = showcaseWordText(w.word, w.upper);
  const gild = Math.max(0, Math.min(4, Math.round(w.prestigeLevel))) as Gild;

  return (
    // Desktop (lg): the word in its scene and the share buttons on the left, the choices on the right.
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="space-y-3">
        {intro}

        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((b) => {
              const meta = ACHIEVEMENT_META[b.achievement];
              if (!meta) return null;
              return (
                <span key={b.achievement} className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-gold/15 px-2.5 py-1 text-xs font-bold" title="Onchain achievement (EAS attestation)">
                  {meta.emoji} {meta.name}
                  {b.achievement === 3 && b.value ? ` ${b.value}%` : ""}
                </span>
              );
            })}
          </div>
        )}

        <div className="cel overflow-hidden rounded-2xl">
          <SceneFrame scene={scene} word={w.word} upper={w.upper} gild={gild} />
        </div>

        <div className="space-y-2">
          <Button full size="lg" variant="primary" onClick={() => postToX({ text: showcaseXText(text), url: showcaseUrl(text, scene) })}>
            <XLogo weight="bold" /> Post {w.word} on X
          </Button>
          <Button full variant="ghost" onClick={() => share({ text: showcasePostText(text), embed: showcaseUrl(text, scene) })}>
            <ShareNetwork weight="fill" /> Cast on Farcaster
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <SectionTitle>Your words</SectionTitle>
          <div role="radiogroup" aria-label="Word to show" className="flex flex-wrap gap-2">
            {words.map((x) => {
              const on = x.word === w.word;
              return (
                <button
                  key={x.word}
                  role="radio"
                  aria-checked={on}
                  aria-label={x.word}
                  onClick={() => setPicked(x.word)}
                  className={`cel-sm press rounded-xl px-2 py-1.5 ${on ? "bg-ink" : "bg-card"}`}
                >
                  <WordTiles word={x.word} upper={x.upper} size={18} detail="tile" />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SectionTitle>Scene</SectionTitle>
          <ScenePicker word={w.word} />
        </div>
      </div>
    </div>
  );
}
