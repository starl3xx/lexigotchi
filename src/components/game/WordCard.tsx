"use client";
/** A claimed Word as a tappable list row → opens the word detail sheet. */
import { HungerBadge, TierBadge } from "./primitives";
import { CaseBadge, PrestigeStars, WordTiles } from "./LetterTile";
import { hunger, jackpotEligible, useGame, wordCase, type OwnedWord } from "./state";

export function WordCard({ word }: { word: OwnedWord }) {
  const { openSheet, state } = useGame();
  const h = hunger(word);
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const earning = word.staked && wordCase(word) === "UPPERCASE" && h !== "hungry";

  return (
    <button
      onClick={() => openSheet({ kind: "word", id: word.id })}
      className={`cel w-full rounded-2xl bg-paper p-3 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
        ${isAnswer ? "ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}
    >
      <div className="flex items-center gap-3">
        <WordTiles word={word.word} upper={word.upper} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-base font-extrabold">
            {word.word}
            <PrestigeStars level={word.prestigeLevel} />
            {earning && <span title="earning yield" aria-hidden>💰</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TierBadge tier={word.tier} />
            {word.staked ? <HungerBadge state={h} /> : <span className="text-[11px] text-ink/50">unstaked</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <CaseBadge word={word} />
          {isAnswer && <span className="text-[11px] font-bold text-candy">today&apos;s word?</span>}
          {word.staked && jackpotEligible(word) && !isAnswer && (
            <span className="text-[11px] text-teal">🎟 jackpot-ready</span>
          )}
        </div>
      </div>
    </button>
  );
}
