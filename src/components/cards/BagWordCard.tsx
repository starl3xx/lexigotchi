"use client";
/**
 * A word in the Bag, as its card (starl3xx, 2026-11-25: "the bag's words should now show these
 * scene/cards instead of just the raw words"): the word standing in its scene, and under the card
 * its rarity's mark, its name, and its three status marks as small icons (game/stageMarks: Fed,
 * Jackpot, Earns, the same marks the Today placard spells out; decisions.md #39). Turn it over in place, or tap it to open the word.
 * Nothing sits on the card's art: the frame is printed in the rarity's ink and carries its mark in
 * the corners, and the mark is repeated by the name, where it is large enough to read.
 *
 * Still, always (a grid of moving scenes is the cost the GPU rules forbid): no scene motion, no
 * bounce, no light. Only the card in focus moves (the Today stage, an opened word).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { useWakeAct } from "../game/wake/useWakeAct";
import { useWordScene } from "../scenes/useWordScene";
import type { Gild } from "../game/TileCharacter";
import { careState, PrestigeStars } from "../game/LetterTile";
import { Pill } from "../game/primitives";
import { Storefront, Ticket } from "../game/ui/icons";
import { fmtWord, hunger, jackpotEligible, useGame, type OwnedWord } from "../game/state";
import { payoutWhen } from "../game/earnings";
import { StatusMarks } from "../game/StatusMarks";
import { markInput, moodOfWord, stageMarks } from "../game/stageMarks";
import { SceneCard } from "./SceneCard";
import { TierMark } from "../game/TierMark";

/**
 * Whether the element has come near the screen (within a screen's height), once: then it stays true.
 * A card's art is two pictures now, not a thousand shapes, but its letters are still full
 * characters (four layers each), so a long Bag draws each card only as it comes near.
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

export function BagWordCard({ word, price, cased = false }: { word: OwnedWord; price?: number; /** In a case (decisions.md #42): the thumbnail wears the plastic's rim and light. */ cased?: boolean }) {
  const g = useGame();
  const { state } = g;
  const { scene } = useWordScene(word.word);
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const face = careState(word);
  // A small part in a wake (game/wake): the card keeps its look until its turn, then its letters hop once.
  const act = useWakeAct(word.word, false);
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  const h = hunger(word);
  const latest = g.earnings?.byWord[word.word]?.latest ?? 0;
  const earned = latest > 0 && g.earnings?.latestAt ? { amount: fmtWord(latest), when: payoutWhen(g.earnings.latestAt) } : undefined;
  const marks = stageMarks(markInput(word, moodOfWord(word, h, price !== undefined), { earned }));
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const answerReady = isAnswer && jackpotEligible(word);

  return (
    <div ref={box} className={`bag-card min-w-0 space-y-1.5 ${answerReady ? "rounded-[14px] ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}>
      <SceneCard
        word={word}
        small
        framed
        className={cased ? "sc-cased" : ""}
        onOpen={() => g.openSheet({ kind: "word", word: word.word })}
        front={
          near ? (
            <SceneFrame scene={scene} word={word.word} upper={word.upper} state={face} states={act.states} tone={act.tone ?? toneOf(face)} gild={gild} tier={word.tier} animated={false} small className={act.hop ? "wk-hop" : ""} />
          ) : (
            <div className="aspect-[16/9] w-full bg-[#fcf7ea]" />
          )
        }
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-0.5">
        <span title={word.tier} className="inline-flex">
          <TierMark tier={word.tier} size={14} />
          <span className="sr-only">{word.tier}</span>
        </span>
        <span className="font-display text-sm font-extrabold">{word.word}</span>
        {cased && <span className="sr-only">In a case</span>}
        <PrestigeStars level={word.prestigeLevel} />
        {/* a listed word's price is the one thing the marks can't say */}
        {price !== undefined && (
          <Pill className="bg-gold/25 text-gold-ink">
            <Storefront weight="fill" size={11} /> {fmtWord(price)}
          </Pill>
        )}
        <StatusMarks marks={marks} compact />
        {answerReady && (
          <Pill className="bg-candy/15 text-candy-ink">
            <Ticket weight="fill" size={11} /> today’s word?
          </Pill>
        )}
      </div>
    </div>
  );
}
