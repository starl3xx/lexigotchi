"use client";
/** A claimed Word as a tappable list row → opens the word detail sheet. */
import { HungerBadge, Pill, TierBadge } from "./primitives";
import { CaseBadge, PrestigeStars, WordTiles, careState } from "./LetterTile";
import { Coins, Storefront, Ticket } from "./ui/icons";
import { useForSale } from "./useForSale";
import { fmtWord, hunger, jackpotEligible, useGame, wordCase, type OwnedWord } from "./state";

export function WordCard({ word }: { word: OwnedWord }) {
  const { openSheet, state, earnings } = useGame();
  const h = hunger(word);
  // What it earned at the latest payout (decisions.md #16), beside the coin.
  const latest = earnings?.byWord[word.word]?.latest ?? 0;
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const answerReady = isAnswer && jackpotEligible(word); // owns the day's word AND it's staked + fed
  const earning = word.staked && wordCase(word) === "UPPERCASE" && h !== "hungry";
  // Listed in the Market (starl3xx: "the fact that they're for sale should also be indicated in the
  // player's Bag"): the price takes the place of "unstaked", which a listed word always is.
  const price = useForSale().get(word.word);

  return (
    <button
      onClick={() => openSheet({ kind: "word", word: word.word })}
      className={`cel w-full rounded-2xl bg-card p-3 text-left press
        ${answerReady ? "ring-2 ring-candy ring-offset-2 ring-offset-paper" : ""}`}
    >
      {/* One wrapping row of badges under the name. A right-hand badge column overlapped the tier
          badge on phones: the name column shrinks (min-w-0) but its nowrap badges don't. */}
      <div className="flex items-center gap-3">
        <WordTiles word={word.word} upper={word.upper} size={30} state={careState(word)} detail="bust" tier={word.tier} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-base font-extrabold">
            {word.word}
            <PrestigeStars level={word.prestigeLevel} />
            {(earning || latest > 0) && (
              <span
                title={latest > 0 ? `earned ${fmtWord(latest)} $WORD at the latest payout` : "earning $WORD"}
                className="inline-flex items-center gap-0.5 text-xs font-bold text-gold-ink"
              >
                <Coins weight="fill" size={14} />
                {latest > 0 && `+${fmtWord(latest)}`}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TierBadge tier={word.tier} />
            {word.staked ? (
              <HungerBadge state={h} />
            ) : price !== undefined ? (
              <Pill className="bg-gold/25 text-gold-ink">
                <Storefront weight="fill" size={11} /> for sale · {fmtWord(price)}
              </Pill>
            ) : (
              <Pill className="bg-card text-ink/60">unstaked</Pill>
            )}
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
