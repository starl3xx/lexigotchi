"use client";
/**
 * The Market (the `swap` view; decisions.md #18 and #30): buy and sell words and letters for $WORD,
 * and see what sold.
 *
 * One page in four parts, behind one switch: **Words** (a list to search, narrow, and sort),
 * **Letters** (the shelf: the whole alphabet with a price tag on every letter that's for sale),
 * **Sell** (the player's own listings, and their words and letters to list), and **Sold** (recent
 * sales). Above the switch, always: what just sold, and, for this player, the listings worth seeing
 * first (lib/market/deals.ts `pickDeals`): a letter that finishes a word their bag is one letter
 * short of, or anything listed under what it costs to make.
 *
 * It is drawn as a market, not as a stack of cards: ruled headings, dashed dividers, and the shelf.
 *
 * It shares the Dictionary's thinking (decisions.md #32): which words are nobody's and what the
 * player's letters are one short of come from `useDictionary` and lib/wordNeed, so the two screens
 * never disagree; a word opens the same word view from both (`useOpenWord`); and each links into
 * the other (`nav` with a section: the word view's "Find a q in the Market" lands on the shelf at
 * q, and a pick's "and 45 more words" lands on those words in the Dictionary).
 *
 * Both stores feed it (`g.market`): the chain game from the Market's routes, the practice game from
 * a seeded stall (market/practiceMarket.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { shopEnabled } from "@/lib/shop/config";
import { WORDS } from "@/lib/dictionary";
import { cardNumber } from "@/lib/cardFacts";
import { isUpperId, letterLabel, letterMakeCost, oneLetterShort, pickDeals, type Deal } from "@/lib/market/deals";
import { finishTokens, needParts, wordNeed, type LetterBag } from "@/lib/wordNeed";
import { Button, Segmented, TierBadge } from "../primitives";
import { LetterTile, WordTiles } from "../LetterTile";
import { MiniTiles } from "../MiniTiles";
import { NeedText } from "../NeedText";
import { TierMark } from "../TierMark";
import { fmtWord, sectionLetter, useGame } from "../state";
import { useDictionary, useOpenWord } from "../useDictionary";
import { useStoredChoice } from "../useStoredChoice";
import { useWorld } from "../useWorld";
import { LettersBoard } from "../market/LettersBoard";
import { SellDesk, type SellKind } from "../market/SellDesk";
import { SoldList, SoldThing } from "../market/SoldList";
import { WordsBoard, useCostPrices } from "../market/WordsBoard";
import { timeAgo } from "../market/bits";
import { useTierOf } from "../useRarity";

type Tab = "words" | "letters" | "sell" | "sold";
const TABS: readonly Tab[] = ["words", "letters", "sell", "sold"];

export function MarketScreen() {
  const tierOf = useTierOf();
  const g = useGame();
  const { state } = g;
  const world = useWorld().data;
  const prices = useCostPrices();
  const [tab, setTab] = useStoredChoice<Tab>("lexi:market:tab", TABS, "words");
  const [openLetter, setOpenLetter] = useState<number | null>(null);
  const [sellLetter, setSellLetter] = useState<number | null>(null);
  const [sellKind, setSellKind] = useState<SellKind>("words");
  // A link lands on the part it names (state.tsx ViewSection): the Bag's "Sell letters" on Sell, on
  // the player's letters; the word view's "Find a q in the Market" on the shelf, with q's sellers
  // showing. After useStoredChoice's own effect, so the link wins over the remembered part. Keyed
  // on the navigation as well as the section: the same link followed again must land again.
  const { section, navSeq } = state;
  useEffect(() => {
    if (section === "sellLetters") {
      setTab("sell");
      setSellKind("letters");
    } else if (section === "words" || section === "letters") {
      setTab(section);
    } else {
      const letter = sectionLetter(section, "letter");
      if (letter === null) return;
      setTab("letters");
      setOpenLetter(letter);
    }
  }, [section, navSeq, setTab]);

  // Words the player is one letter short of, counted as the Dictionary counts them (lib/wordNeed):
  // nobody's words only (a word on the board has an owner), the connected wallet's letters, and a
  // letter in another of the player's wallets is a move, never a letter to buy. Until the game
  // knows who owns what, it can't say a word is free, so it says nothing.
  const { ownersKnown, hasLetters, here, all, statusOf, numbers } = useDictionary();
  const short = useMemo(() => {
    if (!ownersKnown || !hasLetters) return new Map<number, string[]>();
    return oneLetterShort(here, all, WORDS.filter((w) => statusOf(w) === "open"), tierOf);
  }, [ownersKnown, hasLetters, here, all, statusOf, tierOf]);

  const deals = pickDeals({
    book: g.market.letterBook,
    words: g.wordBoard,
    short,
    isMine: g.market.isMine,
    prices,
    balance: state.balance,
    yieldToday: world?.yieldToday,
    tierOf,
  });
  const showLetter = (letterId: number) => {
    setTab("letters");
    setOpenLetter(letterId % 26);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold md:hidden">Market</h1>
        <p className="text-sm text-ink/60">Buy and sell words and letters for $WORD. A sale happens the moment someone buys.</p>
      </div>

      {g.market.unavailable && (
        <p role="status" className="rounded-xl border-2 border-ink bg-candy/10 px-3 py-2 text-sm">
          The Market couldn’t be read just now. It tries again by itself in a few seconds.
        </p>
      )}

      {g.market.sales.length > 0 && (
        <div className="-mx-1 flex items-center gap-3 overflow-x-auto overflow-y-hidden px-1 pb-1" aria-label="Just sold">
          <button type="button" onClick={() => setTab("sold")} className="shrink-0 font-display text-sm font-extrabold underline decoration-2 underline-offset-2">
            Just sold
          </button>
          {g.market.sales.slice(0, 8).map((s) => (
            <button
              key={`${s.tx}:${s.kind}:${s.word ?? s.letterId}`}
              type="button"
              onClick={() => setTab("sold")}
              title={timeAgo(s.at)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink/70"
            >
              {/* a word wears its rarity's mark, as it does everywhere it is named */}
              {s.kind === "word" && s.word && <TierMark tier={tierOf(s.word)} size={12} />}
              <SoldThing sale={s} size={24} />
              {s.kind === "letter" && s.qty > 1 && <span>×{s.qty}</span>}
              <strong className="font-display text-ink tabular-nums">{fmtWord(s.kind === "letter" ? s.unitPrice : s.price)}</strong>
            </button>
          ))}
        </div>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "words", label: g.wordBoard.length > 0 ? `Words ${g.wordBoard.length}` : "Words" },
          { value: "letters", label: "Letters" },
          { value: "sell", label: "Sell" },
          { value: "sold", label: "Sold" },
        ]}
      />

      {deals.length > 0 && (tab === "words" || tab === "letters") && (
        <section className="rounded-2xl border-[3px] border-dashed border-ink/40 bg-gold/10 px-3 py-1.5">
          <h2 className="sr-only">For you</h2>
          <ul className="divide-y-2 divide-dashed divide-ink/15">
            {deals.map((d) => (
              <DealRow
                key={d.kind === "word" ? d.listing.orderHash : d.ask.orderHash}
                deal={d}
                here={here}
                all={all}
                number={d.kind === "word" ? numbers?.[d.listing.word] : undefined}
                onLetter={showLetter}
              />
            ))}
          </ul>
        </section>
      )}

      {tab === "words" && <WordsBoard />}
      {tab === "letters" && (
        <LettersBoard
          open={openLetter}
          setOpen={setOpenLetter}
          short={short}
          here={here}
          all={all}
          flagged={new Set(deals.flatMap((d) => (d.kind === "finish" ? [d.ask.letterId % 26] : [])))}
          onSell={(letterId) => {
            setSellLetter(letterId);
            setSellKind("letters");
            setTab("sell");
          }}
        />
      )}
      {tab === "sell" && <SellDesk kind={sellKind} setKind={setSellKind} letter={sellLetter} setLetter={setSellLetter} />}
      {tab === "sold" && <SoldList />}

      <p className="border-t-2 border-ink/15 pt-3 text-xs text-ink/55">
        The buyer pays the price in $WORD: 90% goes to the seller, and 10% to the Rewards Pool, which pays staked words. A word arrives with
        its letters, case, and ascension. “To make” is about what a thing costs to build at today’s prices, with the average number of tries.
        {/* The Customization Spec: taste stays with the player (decisions.md #22). Only once there's a Shop. */}
        {shopEnabled() && " Card faces, cases, and costumes stay with the seller."}
      </p>
    </div>
  );
}

/** One listing picked for this player, said as a sentence, with its price and a Buy. */
function DealRow({
  deal: d,
  here,
  all,
  number,
  onLetter,
}: {
  deal: Deal;
  /** The player's letters, to draw the word a letter finishes with its gap. */
  here: LetterBag;
  all: LetterBag;
  /** A picked word's card number, when it is known. */
  number?: number;
  onLetter: (letterId: number) => void;
}) {
  const tierOf = useTierOf();
  const g = useGame();
  const openWord = useOpenWord();
  const [busy, setBusy] = useState(false);
  const pct = (under: number) => `${Math.round(under * 100)}% under what it costs to make`;
  if (d.kind === "word") {
    const l = d.listing;
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="word-press" aria-label={`Open ${l.word}`} onClick={() => openWord(l.word)}>
              <WordTiles word={l.word} upper={[...l.upper]} size={22} tier={tierOf(l.word)} still />
            </button>
            <TierBadge tier={tierOf(l.word)} />
            {number ? <span className="text-xs font-bold tabular-nums text-ink/60">{cardNumber(number)}</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-ink/70">
            <strong className="text-teal-ink">{pct(d.under)[0].toUpperCase() + pct(d.under).slice(1)}</strong>
            {d.earns ? `. Earns about ${fmtWord(d.earns)} $WORD a day, staked and fed` : ""}
          </p>
        </div>
        <Button size="sm" variant="teal" className="shrink-0" onClick={() => g.buyWord(l.orderHash)}>
          Buy for {fmtWord(l.price)}
        </Button>
      </li>
    );
  }
  const a = d.ask;
  const name = letterLabel(a.letterId);
  const make = letterMakeCost(a.letterId, { pack: g.price("pack"), roll: g.price("roll") });
  const buy = (
    <Button
      size="sm"
      variant="teal"
      className="shrink-0"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await g.market.buyLetters(a, 1);
        setBusy(false);
      }}
    >
      Buy for {fmtWord(a.unitPrice)}
    </Button>
  );
  if (d.kind === "finish") {
    // The word as the Dictionary draws it: the player's letters, and a dashed slot where this one goes.
    const need = wordNeed(d.word, here, all);
    const more = needParts(need, d.word)[0]?.more ?? false;
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* the letter's tile opens its sellers too; the sentence beside it is the one a keyboard reaches */}
          <button type="button" tabIndex={-1} aria-hidden className="shrink-0" onClick={() => onLetter(a.letterId)}>
            <LetterTile char={name} upper={isUpperId(a.letterId)} size={34} />
          </button>
          <div className="min-w-0 text-xs text-ink/70">
            <button type="button" className="block text-left font-display text-sm font-extrabold leading-tight text-ink" onClick={() => onLetter(a.letterId)}>
              <NeedText tokens={finishTokens(name, more, d.word)} />
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button type="button" className="word-press" aria-label={`Open ${d.word}`} onClick={() => openWord(d.word)}>
                <MiniTiles word={d.word} upper={need.upper} letters={need.letters} tier={tierOf(d.word)} />
              </button>
              {d.alsoFinishes > 0 && (
                <button type="button" className="font-bold text-teal-ink underline" onClick={() => g.nav("dictionary", `needs:${name.toLowerCase()}`)}>
                  and {d.alsoFinishes.toLocaleString("en-US")} more word{d.alsoFinishes === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </div>
        </div>
        {buy}
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => onLetter(a.letterId)}>
        <LetterTile char={name} upper={isUpperId(a.letterId)} size={34} />
        <span className="min-w-0 text-xs text-ink/70">
          <strong className="block font-display text-sm leading-tight text-ink">
            {isUpperId(a.letterId) ? `An UPPERCASE ${name}` : `A lowercase ${name}`} for less
          </strong>
          <span className="font-bold text-teal-ink">{pct(d.under)}</span>, about {fmtWord(make)}
        </span>
      </button>
      {buy}
    </li>
  );
}
