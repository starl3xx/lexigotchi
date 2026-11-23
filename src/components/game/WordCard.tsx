"use client";
/** A claimed Word as a tappable list row → opens the word detail sheet. */
import { HungerBadge, Pill, TierBadge } from "./primitives";
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
      className={`cel w-full rounded-2xl bg-card p-3 text-left press
        ${answerReady ? "ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}
    >
      {/* One wrapping row of badges under the name. A right-hand badge column overlapped the tier
          badge on phones: the name column shrinks (min-w-0) but its nowrap badges don't. */}
      <div className="flex items-center gap-3">
        <WordTiles word={word.word} upper={word.upper} size={30} state={careState(word)} detail="bust" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-base font-extrabold">
            {word.word}
            <PrestigeStars level={word.prestigeLevel} />
            {earning && (
              <span title="earning $WORD" className="text-gold-ink">
                <Coins weight="fill" size={14} />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TierBadge tier={word.tier} />
            {word.staked ? <HungerBadge state={h} /> : <Pill className="bg-card text-ink/60">unstaked</Pill>}
            <CaseBadge word={word} />
            {answerReady && (
              <Pill className="bg-candy/15 text-candy-ink">
                <Ticket weight="fill" size={11} /> today’s word?
              </Pill>
            )}
            {isAnswer && !answerReady && <Pill className="bg-candy/15 text-candy-ink">today’s word: stake and feed it!</Pill>}
            {word.staked && jackpotEligible(word) && !isAnswer && (
              <Pill className="bg-teal/20 text-teal-ink">
                <Ticket weight="fill" size={11} /> in the jackpot
              </Pill>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
