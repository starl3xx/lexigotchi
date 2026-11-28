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
          badge on phones: the name column shrinks (min-w-0) but its nowrap badges don't.
          The name's own row had the same fault: beside the tiles a phone leaves the text about
          120 px, and a Holographic word's five stars and its payout ("+891.9K") drew past the
          card's border and made the page scroll sideways. So the text takes the room beside the
          tiles only where it has 12rem of it, and goes under them where it doesn't (every phone,
          and the two-column screen at 1024 px: the card's width decides, not the screen's); the
          name's row wraps too, for a card narrower still. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <WordTiles word={word.word} upper={word.upper} size={30} state={careState(word)} detail="bust" tier={word.tier} still />
        <div className="min-w-0 flex-[1_1_12rem]">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-base font-extrabold">
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
            {isAnswer && !answerReady && <Pill className="bg-candy/15 text-candy-ink">today’s word: stake and wake it!</Pill>}
            {word.staked && jackpotEligible(word) && !isAnswer && (
              <Pill className="bg-teal/20 text-teal-ink">
                <Ticket weight="fill" size={11} /> jackpot-eligible
              </Pill>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
