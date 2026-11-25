"use client";
/**
 * A word in the Bag, as its card (starl3xx, 2026-11-25: "the bag's words should now show these
 * scene/cards instead of just the raw words"): the word standing in its scene, its rarity in the
 * corner, and its name and state underneath. Turn it over in place, or tap it to open the word.
 *
 * Still, always (a grid of moving scenes is the cost the GPU rules forbid): no scene motion, no
 * bounce, no light. Only the card in focus moves (the Today stage, an opened word).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { useWordScene } from "../scenes/useWordScene";
import type { Gild } from "../game/TileCharacter";
import { careState, PrestigeStars } from "../game/LetterTile";
import { HungerBadge, Pill } from "../game/primitives";
import { Coins, Storefront, Ticket } from "../game/ui/icons";
import { fmtWord, hunger, jackpotEligible, useGame, wordCase, type OwnedWord } from "../game/state";
import { SceneCard } from "./SceneCard";
import { Gem } from "./CardBack";
import { materialOf } from "./material";

/**
 * Whether the element has come near the screen (within a screen's height), once: then it stays true.
 * A scene is about a thousand drawn elements, so a Bag of 32 words drew 32,000 on opening and kept a
 * 4×-slowed phone busy for seconds; drawing each card's scene as it comes near costs only the ones
 * in view.
 */
function useNear(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") return void setNear(true);
    // The game scrolls inside <main>, not the window: a margin on the window would never reach a
    // card below the fold (the scroller clips it first), so the scroller is the root.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { root: el.closest("main"), rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}

export function BagWordCard({ word, price }: { word: OwnedWord; price?: number }) {
  const g = useGame();
  const { state } = g;
  const { scene } = useWordScene(word.word);
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const face = careState(word);
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  const h = hunger(word);
  const earning = word.staked && wordCase(word) === "UPPERCASE" && h !== "hungry";
  const latest = g.earnings?.byWord[word.word]?.latest ?? 0;
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const answerReady = isAnswer && jackpotEligible(word);

  return (
    <div ref={box} className={`bag-card min-w-0 space-y-1.5 ${answerReady ? "rounded-[14px] ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}>
      <SceneCard
        word={word}
        small
        framed
        onOpen={() => g.openSheet({ kind: "word", word: word.word })}
        front={
          <>
            {near ? (
              <SceneFrame scene={scene} word={word.word} upper={word.upper} state={face} tone={toneOf(face)} gild={gild} tier={word.tier} animated={false} />
            ) : (
              <div className="aspect-[16/9] w-full bg-night" />
            )}
            <span className={`sc-badge m-${materialOf(word.tier)}`}>
              <Gem />
              {word.tier}
            </span>
          </>
        }
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-0.5">
        <span className="font-display text-sm font-extrabold">{word.word}</span>
        <PrestigeStars level={word.prestigeLevel} />
        {(earning || latest > 0) && (
          <span
            title={latest > 0 ? `earned ${fmtWord(latest)} $WORD at the latest payout` : "earning $WORD"}
            className="inline-flex items-center gap-0.5 text-xs font-bold text-gold-ink"
          >
            <Coins weight="fill" size={13} />
            {latest > 0 && `+${fmtWord(latest)}`}
          </span>
        )}
        {word.staked ? (
          <HungerBadge state={h} />
        ) : price !== undefined ? (
          <Pill className="bg-gold/25 text-gold-ink">
            <Storefront weight="fill" size={11} /> {fmtWord(price)}
          </Pill>
        ) : (
          <Pill className="bg-card text-ink/60">unstaked</Pill>
        )}
        {answerReady && (
          <Pill className="bg-candy/15 text-candy-ink">
            <Ticket weight="fill" size={11} /> today’s word?
          </Pill>
        )}
      </div>
    </div>
  );
}
