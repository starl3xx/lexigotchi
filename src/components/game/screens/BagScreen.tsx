"use client";
/**
 * Bag: your words, as cards (components/cards), and your loose letters (tap a lowercase one to raise
 * it). It opens on Words while you have words, or while they are still on their way (starl3xx,
 * 2026-11-25: "bag should default to words first"); a player with none lands on Letters.
 */
import { useState } from "react";
import { Button, EmptyState, SectionTitle, Segmented } from "../primitives";
import { LetterTile } from "../LetterTile";
import { BagWordCard } from "../../cards/BagWordCard";
import { Basket, Alarm, Sparkle, Storefront, TextAa } from "../ui/icons";
import { feedAllLabel, wordsToFeed } from "../feedAll";
import { hunger, idxToChar, useGame, mineLower, mineUpper, type OwnedWord } from "../state";
import { GameWalletNotice } from "../GameWalletNotice";
import { WordsPending, wordsUnknown } from "../WordsPending";
import { EarningsLine } from "../EarningsLine";
import { LETTER_SORTS, WORD_FILTERS, WORD_FILTER_LABEL, WORD_SORTS, WORD_SORT_LABEL, matchesWord, sortLetters, sortWords, wordFilterCounts, type LetterSort, type WordFilter, type WordSort } from "../bagView";
import { useForSale } from "../useForSale";
import { useWordCases } from "../useShop";
import { useStoredChoice } from "../useStoredChoice";

export function BagScreen() {
  const g = useGame();
  const { state } = g;
  // The tab the player chose; until they choose, Words when there are words (or they are loading).
  const [chosenTab, setTab] = useState<"letters" | "words" | null>(null);
  const tab = chosenTab ?? (state.section === "letters" || !(state.words.length > 0 || wordsUnknown(state)) ? "letters" : "words");

  const [letterSort, setLetterSort] = useStoredChoice<LetterSort>("lexi:bag:letters:sort", LETTER_SORTS, "az");
  const [wordFilter, setWordFilter] = useStoredChoice<WordFilter>("lexi:bag:words:filter", WORD_FILTERS, "all");
  const [wordSort, setWordSort] = useStoredChoice<WordSort>("lexi:bag:words:sort", WORD_SORTS, "best");
  const forSale = useForSale();
  const cases = useWordCases();
  const ctx = { hungerOf: (w: OwnedWord) => hunger(w), forSale: new Set(forSale.keys()) };
  const counts = wordFilterCounts(state.words, ctx);
  // A filter whose words all left (sold, staked, fed) shows everything rather than an empty list.
  const filter = counts[wordFilter] > 0 ? wordFilter : "all";
  const shown = sortWords(state.words.filter((w) => matchesWord(w, filter, ctx)), wordSort, ctx.hungerOf);
  const toFeed = wordsToFeed(state.words);

  const lowerOwned = sortLetters(state.lower.map((c, i) => ({ i, c })).filter((x) => x.c > 0), letterSort);
  const upperOwned = sortLetters(state.upper.map((c, i) => ({ i, c })).filter((x) => x.c > 0), letterSort);
  const lowerCount = state.lower.reduce((a, b) => a + b, 0);
  const upperCount = state.upper.reduce((a, b) => a + b, 0);
  // An empty bag points at the free pack only while the server says it's there to take
  // (docs/messaging.md: "No letters yet. Your free pack is waiting."). "No letters yet" is for a bag
  // that has never held anything: letters spelled into words leave the loose counts too, so a player
  // with words (or whose words haven't loaded) reads "No loose letters" (Bugbot on #205).
  const fl = g.freeLetters;
  const packWaiting = !!fl && !fl.packTaken && !fl.packStop;
  const newBag = lowerCount + upperCount === 0 && state.words.length === 0 && !wordsUnknown(state);

  // The union bag counts everything the player's linked wallets hold; the difference from the
  // connected wallet's own counts is what spelling/rolling can't touch from here.
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const elsewhere =
    lowerCount + upperCount - (sum(mineLower(state)) + sum(mineUpper(state)));

  return (
    <div className="space-y-3">
      <GameWalletNotice />
      <Segmented
        className="md:max-w-sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "words", label: <>Words · {state.words.length}</> },
          { value: "letters", label: <>Letters · {lowerCount + upperCount}</> },
        ]}
      />

      {tab === "letters" ? (
        <div className="space-y-4">
          {lowerOwned.length + upperOwned.length > 1 && (
            <Segmented
              className="max-w-[16rem] text-xs"
              value={letterSort}
              onChange={setLetterSort}
              options={[
                { value: "az", label: "A to Z" },
                { value: "most", label: "Most first" },
              ]}
            />
          )}
          {elsewhere > 0 && (
            <p className="text-xs text-ink/55">
              {elsewhere} of these live in your linked wallets. They count in your bag, but
              spelling and rolling use the connected wallet’s letters.
            </p>
          )}
          <div>
            <SectionTitle action={<span className="text-xs text-ink/55">tap to raise →</span>}>
              lowercase · {lowerCount}
            </SectionTitle>
            {lowerOwned.length === 0 ? (
              <EmptyState
                Icon={Basket}
                title={newBag ? "No letters yet" : "No loose letters"}
                sub={packWaiting ? "Your free pack is waiting." : "Mint a pack to fill your bag."}
              />
            ) : (
              <div className={LETTER_GRID}>
                {lowerOwned.map(({ i, c }) => (
                  <BagLetter
                    key={i}
                    char={idxToChar(i)}
                    count={c}
                    title={`Raise ${idxToChar(i).toLowerCase()} → ${idxToChar(i)}`}
                    onClick={() => g.openSheet({ kind: "roll", target: { kind: "loose", idx: i } })}
                  />
                ))}
              </div>
            )}
          </div>

          {upperCount > 0 && (
            <div>
              <SectionTitle>UPPERCASE · {upperCount}</SectionTitle>
              <div className={LETTER_GRID}>
                {upperOwned.map(({ i, c }) => (
                  <BagLetter key={i} char={idxToChar(i)} upper count={c} title={`${idxToChar(i)} (raised)`} />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink/55">Raised letters go into any word, with lowercase ones or on their own. Spell one in Spell.</p>
            </div>
          )}

          <Button full variant="ghost" onClick={() => g.nav("mint")}>
            <Sparkle weight="fill" /> Mint more letters
          </Button>
          {/* Loose letters sell on the Market (decisions.md #30): this opens its Sell page on them. */}
          {lowerCount + upperCount > 0 && (
            <Button full variant="ghost" onClick={() => g.nav("swap", "sellLetters")}>
              <Storefront weight="fill" /> Sell letters on the Market
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {/* the heading and the empty state span both columns; only the cards pair up (Bugbot) */}
          <div className="lg:col-span-2">
            <SectionTitle
              action={
                <div className="flex gap-2">
                  {/* Feed all (yours and the words you care for): one send, the free snack first. */}
                  {toFeed.length > 0 && (
                    <Button size="sm" variant="teal" onClick={() => g.feedAll()}>
                      <Alarm weight="fill" /> {feedAllLabel(toFeed)}
                    </Button>
                  )}
                  <Button size="sm" variant="primary" onClick={() => g.nav("claim")}>+ Spell</Button>
                </div>
              }
            >
              Claimed words
            </SectionTitle>
            {/* what the words earned (decisions.md #16); opens Your earnings */}
            <div className="mb-2 empty:hidden">
              <EarningsLine />
            </div>
            {state.words.length > 1 && (
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {/* Room above and below for the chips' hover lift and shadow, and no vertical scrolling: a
                    box that scrolls sideways clips up and down too (the Market's row showed it). */}
                <div className="-my-1 -ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto overflow-y-hidden px-1 py-2" role="group" aria-label="Show">
                  {WORD_FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setWordFilter(f)}
                      className={`press min-h-8 shrink-0 whitespace-nowrap rounded-full border-2 border-ink px-3 text-xs font-bold ${
                        filter === f ? "bg-ink text-paper" : "bg-card text-ink/75"
                      }`}
                    >
                      {WORD_FILTER_LABEL[f]} {f === "all" ? state.words.length : counts[f]}
                    </button>
                  ))}
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-ink/60">
                  Sort
                  <select
                    value={wordSort}
                    onChange={(e) => setWordSort(e.target.value as WordSort)}
                    className="min-h-8 rounded-lg border-2 border-ink bg-card px-2 text-xs font-bold text-ink"
                  >
                    {WORD_SORTS.map((s) => (
                      <option key={s} value={s}>
                        {WORD_SORT_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
          {state.words.length === 0 ? (
            <div className="lg:col-span-2">
              {/* the words' read may be on its way, or have failed: "no words" would be wrong then */}
              {wordsUnknown(state) ? (
                <WordsPending />
              ) : (
                <EmptyState Icon={TextAa} title="No words yet" sub="Five letters make one." />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 lg:col-span-2 lg:grid-cols-3">
              {shown.map((w) => (
                <BagWordCard key={w.word} word={w} price={forSale.get(w.word)} cased={cases.cased.has(w.word)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** Phones: six flat tiles a row. Desktop: the letters as characters (the rig's bust art), sized to
 *  fill the wider column instead of a thin row of small squares across an empty page. */
const LETTER_GRID = "grid grid-cols-6 gap-2.5 md:grid-cols-[repeat(auto-fill,76px)] md:gap-3";

function BagLetter(props: { char: string; upper?: boolean; count: number; title: string; onClick?: () => void }) {
  return (
    <>
      <div className="md:hidden">
        <LetterTile {...props} />
      </div>
      <div className="hidden md:block">
        <LetterTile {...props} size={68} />
      </div>
    </>
  );
}
