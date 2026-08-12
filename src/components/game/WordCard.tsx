"use client";
/** A claimed Word as a tappable list row → opens the word detail sheet. */
import { HungerBadge, TierBadge } from "./primitives";
import { CaseBadge, PrestigeStars, WordTiles, careState } from "./LetterTile";
import { Coins, Ticket } from "./ui/icons";
import { hunger, jackpotEligible, useGame, wordCase, type OwnedWord } from "./state";

export function WordCard({ word }: { word: OwnedWord }) {
  const { openSheet, state } = useGame();
  const h = hunger(word);
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const answerReady = isAnswer && jackpotEligible(word); // owns the day's word AND it's staked + fed
  const earning = word.staked && wordCase(word) === "UPPERCASE" && h !== "hungry";

  return (
    <button
      onClick={() => openSheet({ kind: "word", word: word.word })}
      className={`cel w-full rounded-2xl bg-paper p-3 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
        ${answerReady ? "ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}
    >
      <div className="flex items-center gap-3">
        <WordTiles word={word.word} upper={word.upper} size={30} state={careState(word)} detail="bust" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-base font-extrabold">
            {word.word}
            <PrestigeStars level={word.prestigeLevel} />
            {earning && (
              <span title="earning yield" className="text-gold-deep">
                <Coins weight="fill" size={14} />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TierBadge tier={word.tier} />
            {word.staked ? <HungerBadge state={h} /> : <span className="text-[11px] text-ink/50">unstaked</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <CaseBadge word={word} />
          {answerReady && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-candy">
              today&apos;s word? <Ticket weight="fill" size={11} />
            </span>
          )}
          {isAnswer && !answerReady && (
            <span className="text-[11px] font-bold text-candy">today&apos;s word — stake &amp; feed!</span>
          )}
          {word.staked && jackpotEligible(word) && !isAnswer && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-teal">
              <Ticket weight="fill" size={11} /> jackpot-ready
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
