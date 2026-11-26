"use client";
/**
 * Words for sale (decisions.md #18, #30), as a list a player can search, narrow, and sort, however
 * long it gets: find a word by its letters, show one rarity, only all-UPPERCASE words (they earn once
 * staked), or only what the player's $WORD can buy, and order by the best deal, the price, the
 * newest, or the rarest. A word is one of a kind, so the list can never be longer than the dictionary.
 *
 * Each row shows the word as it is NOW (case, ascension, hunger), read live by the board's route, and
 * its price against what it costs to make. "Yours" is the player, not the wallet: only the wallet
 * that listed a word can take it off sale.
 */
import { useMemo, useState } from "react";
import { TIERS, wordTier, type Tier } from "@/lib/economy";
import { costToMake, type CostPrices } from "@/lib/wordCost";
import { filterWords, sortWords, type CaseFilter, type WordSort } from "@/lib/market/deals";
import { Button, TierBadge } from "../primitives";
import { PrestigeStars, WordTiles } from "../LetterTile";
import { PlayerChip } from "../PlayerChip";
import { fmtWord, useGame, type WordListing } from "../state";
import { useStoredChoice } from "../useStoredChoice";
import { WordValue } from "../WordValue";
import { shortAddress } from "../useWorld";
import { Versus, timeAgo, useAmount } from "./bits";

const SORTS: readonly WordSort[] = ["deal", "low", "high", "new", "rare"];
const SORT_LABEL: Record<WordSort, string> = {
  deal: "Best deal first",
  low: "Lowest price",
  high: "Highest price",
  new: "Newest",
  rare: "Rarest first",
};
const PAGE = 20;

const chip = (on: boolean) =>
  `press min-h-8 shrink-0 whitespace-nowrap rounded-full border-2 border-ink px-3 text-xs font-bold ${on ? "bg-ink text-paper" : "bg-card text-ink/75"}`;

export function useCostPrices(): CostPrices {
  const g = useGame();
  const pack = g.price("pack");
  const roll = g.price("roll");
  const claim = g.price("claim");
  const prestigeSnack = g.price("prestigeSnack");
  const prestigeFee = g.prestigePrice;
  return useMemo(() => ({ pack, roll, claim, prestigeSnack, prestigeFee }), [pack, roll, claim, prestigeSnack, prestigeFee]);
}

export function WordsBoard() {
  const g = useGame();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [cases, setCases] = useState<CaseFilter>("all");
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useStoredChoice<WordSort>("lexi:market:words:sort", SORTS, "deal");
  const [limit, setLimit] = useState(PAGE);
  const prices = useCostPrices();

  const listings = g.wordBoard;
  const makeCost = (l: WordListing) => {
    const c = costToMake({ word: l.word, upper: l.upper, prestigeLevel: l.prestigeLevel }, prices);
    return Number.isFinite(c.total) && c.total > 0 ? c.total : null;
  };
  const tierCounts = useMemo(() => {
    const n = new Map<Tier, number>();
    for (const l of listings) n.set(wordTier(l.word), (n.get(wordTier(l.word)) ?? 0) + 1);
    return n;
  }, [listings]);
  const rows = sortWords(filterWords(listings, { q, tier, cases, within: mine ? g.state.balance : null }), sort, makeCost);
  const shown = rows.slice(0, limit);
  const narrowed = q.trim() !== "" || tier !== "all" || cases !== "all" || mine;

  if (listings.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink/55">
        {g.market.loading ? "Reading what’s for sale…" : "No words are for sale right now. To sell one of yours, open Sell."}
      </p>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="market-find">
          Find a word
        </label>
        <input
          id="market-find"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5));
            setLimit(PAGE);
          }}
          placeholder="Find a word"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="min-h-9 min-w-0 flex-1 rounded-xl border-2 border-ink bg-card px-3 text-sm font-bold uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-candy"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-ink/60">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as WordSort)} className="min-h-9 rounded-lg border-2 border-ink bg-card px-2 text-xs font-bold text-ink">
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* The chips lift on hover and deepen their shadow (.press), and a box that scrolls sideways clips
          up and down too: the row cut the lifted chip off and grew a scrollbar (starl3xx, 2026-11-25).
          So: room above and below the chips, no vertical scrolling, and from md the chips wrap in a
          plain row that clips nothing. */}
      <div className="-mx-1 mt-1 flex gap-1.5 overflow-x-auto overflow-y-hidden px-1 pb-2 pt-1 md:flex-wrap md:overflow-visible" role="group" aria-label="Show">
        <button type="button" aria-pressed={tier === "all"} onClick={() => setTier("all")} className={chip(tier === "all")}>
          All {listings.length}
        </button>
        {[...TIERS].reverse().filter((t) => tierCounts.has(t.name)).map((t) => (
          <button key={t.name} type="button" aria-pressed={tier === t.name} onClick={() => { setTier(tier === t.name ? "all" : t.name); setLimit(PAGE); }} className={chip(tier === t.name)}>
            {t.name} {tierCounts.get(t.name)}
          </button>
        ))}
        <span aria-hidden className="mx-0.5 w-px shrink-0 self-stretch bg-ink/20" />
        <button type="button" aria-pressed={cases === "upper"} onClick={() => setCases(cases === "upper" ? "all" : "upper")} className={chip(cases === "upper")}>
          All UPPERCASE
        </button>
        <button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={chip(mine)}>
          Within my $WORD
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink/55">
          Nothing for sale matches that.{" "}
          <button type="button" className="font-bold text-teal-ink underline" onClick={() => { setQ(""); setTier("all"); setCases("all"); setMine(false); }}>
            Show everything
          </button>
        </p>
      ) : (
        <ul className="mt-1 lg:grid lg:grid-cols-2 lg:gap-x-8">
          {shown.map((l) => (
            <WordRow key={l.orderHash} listing={l} cost={makeCost(l)} prices={prices} />
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <div className="mt-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more of {rows.length}
          </Button>
        </div>
      )}
      {narrowed && rows.length > 0 && (
        <p className="mt-2 text-center text-xs text-ink/50">
          {rows.length} of {listings.length} words for sale.
        </p>
      )}
    </div>
  );
}

function WordRow({ listing: l, cost, prices }: { listing: WordListing; cost: number | null; prices: CostPrices }) {
  const g = useGame();
  const amount = useAmount();
  const mine = g.market.isMine(l.maker);
  const here = g.market.isHere(l.maker);
  const unfed = l.lastFedAt > 0 ? Math.floor((Date.now() / 1000 - l.lastFedAt) / 86_400) : 0;
  const shape = { word: l.word, upper: l.upper, prestigeLevel: l.prestigeLevel };
  const parts = costToMake(shape, prices);
  const tier = wordTier(l.word);
  return (
    <li className={`flex items-start justify-between gap-3 border-b-2 border-dashed border-ink/15 py-3 ${mine ? "bg-gold/10 -mx-2 px-2 rounded-lg" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <WordTiles word={l.word} upper={l.upper} size={26} tier={tier} still />
          <TierBadge tier={tier} />
          <PrestigeStars level={l.prestigeLevel} />
          {mine && <span className="rounded-full border-2 border-ink bg-card px-1.5 py-0.5 text-[10px] font-bold">Yours</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink/60">
          <Versus price={l.price} reference={cost} />
          {l.lastSale && <span>Last sold for {fmtWord(l.lastSale.price)}, {timeAgo(l.lastSale.at)}.</span>}
          {l.prestigePity > 0 && <span>{l.prestigePity} failed ascension{l.prestigePity === 1 ? "" : "s"}, so better odds next time.</span>}
          {unfed > 0 && <span>Unfed {unfed} day{unfed === 1 ? "" : "s"}.</span>}
        </div>
        <WordValue word={shape} cost={cost ? parts : null} compact />
        {!mine && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
            <PlayerChip address={l.maker} profile={l.face} size={18} />
            {l.listedAt && <span>{timeAgo(Date.parse(l.listedAt))}</span>}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="text-right" title={amount(l.price)}>
          <div className="font-display text-lg font-extrabold leading-none tabular-nums">{fmtWord(l.price)}</div>
          <div className="text-[11px] text-ink/55">$WORD</div>
        </div>
        {mine ? (
          here ? (
            <button type="button" onClick={() => g.cancelWordListing(l.orderHash)} className="text-xs font-bold text-ink/55 underline">
              Take off sale
            </button>
          ) : (
            <span className="max-w-28 text-right text-[11px] leading-tight text-ink/50">From {shortAddress(l.maker)}. Switch to it to take it off sale.</span>
          )
        ) : (
          <Button size="sm" variant="teal" onClick={() => g.buyWord(l.orderHash)}>
            Buy
          </Button>
        )}
      </div>
    </li>
  );
}
