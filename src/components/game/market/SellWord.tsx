"use client";
/**
 * Sell a word (decisions.md #18, #30): a price in $WORD, a free signature, and 10% of the sale goes
 * to the Rewards Pool. One form, in two places: under an opened word, and on the Market's Sell page.
 *
 * The form helps with the price (starl3xx, 2026-11-25: "helping the user with suggested prices,
 * comparison"): what the word costs to make, what it last sold for, and what its rarity's words have
 * been going for, each one tap to use. A staked word can't be listed (Seaport needs the seller to
 * hold it), and a word for sale earns nothing and has no jackpot entry, so the form says so.
 */
import { useState } from "react";
import { shopEnabled } from "@/lib/shop/config";
import { DEFAULT_PARAMS } from "@/lib/params";
import { MIN_WORD_PRICE } from "@/lib/onchain/wordSale";
import { roundPrice } from "@/lib/wordCost";
import { tierLowest, wordPriceIdeas } from "@/lib/market/deals";
import { Button } from "../primitives";
import { Coins } from "../ui/icons";
import { fmtWord, useGame, type OwnedWord } from "../state";
import { WordValue, useCostToMake } from "../WordValue";
import { FormHead, PriceHint, PriceIdeas, PriceInput, priceOf, priceText, useAmount } from "./bits";
import { useTierOf } from "../useRarity";

/** The Market's fee on a word (params `market.wordSaleFee`, 10%), the same number the order builder uses. */
const SALE_FEE = DEFAULT_PARAMS.market.wordSaleFee;

export function SellWord({ word, startOpen = false, onClose }: { word: OwnedWord; startOpen?: boolean; onClose?: () => void }) {
  const tierOf = useTierOf();
  const g = useGame();
  const amount = useAmount();
  const listing = g.wordBoard.find((l) => l.word === word.word && g.market.isHere(l.maker));
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const price = priceOf(text);
  const fee = Math.ceil(price * SALE_FEE);
  const cost = useCostToMake(word);
  const ideas = wordPriceIdeas({
    makeCost: cost?.total ?? null,
    lastSale: listing?.lastSale?.price ?? g.market.sales.find((s) => s.kind === "word" && s.word === word.word)?.price,
    tier: word.tier,
    tierStat: g.market.tierStats[word.tier],
    tierLowest: tierLowest(g.wordBoard, word.tier, g.market.isMine, word.word, tierOf),
    minPrice: MIN_WORD_PRICE,
  });
  const close = () => {
    setOpen(false);
    setText("");
    onClose?.();
  };

  if (listing && !open) {
    return (
      <div className="mb-3 rounded-xl border-2 border-ink bg-gold/10 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0">
            For sale at <strong className="font-display">{amount(listing.price)}</strong>
          </span>
          <span className="flex shrink-0 gap-3 text-xs font-bold">
            <button type="button" onClick={() => setOpen(true)} className="text-teal-ink underline">
              Change the price
            </button>
            <button type="button" onClick={() => g.cancelWordListing(listing.orderHash)} className="text-ink/55 underline">
              Take off sale
            </button>
          </span>
        </div>
        <p className="mt-1 text-xs text-ink/60">
          It sells the moment someone buys it. You get {fmtWord(listing.price - Math.ceil(listing.price * SALE_FEE))} $WORD.
        </p>
        <WordValue word={word} cost={cost} compact />
      </div>
    );
  }
  if (word.staked) {
    return <p className="mb-3 text-center text-xs text-ink/55">To sell {word.word}, unstake it first.</p>;
  }
  if (!open) {
    return (
      <Button full variant="ghost" className="mb-3" onClick={() => setOpen(true)}>
        <Coins weight="fill" /> Sell {word.word}
      </Button>
    );
  }
  return (
    <form
      className="mb-3 rounded-xl border-2 border-ink bg-card px-3 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const ok = await g.listWord(word.word, price);
        setBusy(false);
        if (ok) close();
      }}
    >
      <FormHead title={listing ? `Change the price of ${word.word}` : `Sell ${word.word}`} onClose={close} />
      <WordValue word={word} cost={cost} />
      <PriceIdeas ideas={ideas} current={price} onPick={(n) => setText(priceText(n))} />
      <label className="mt-3 block text-xs font-bold text-ink/60" htmlFor={`sell-${word.word}`}>
        {listing ? "New price, in $WORD" : "Price, in $WORD"}
      </label>
      <div className="mt-1 flex gap-2">
        <PriceInput id={`sell-${word.word}`} value={text} onChange={setText} placeholder="2,000,000" />
        <Button size="sm" variant="teal" type="submit" disabled={busy || price <= 0}>
          {listing ? "Set it" : "List it"}
        </Button>
      </div>
      <PriceHint text={text} />
      <p className="mt-2 text-xs text-ink/60">
        {price > 0
          ? `The buyer pays ${amount(price)}. You get ${fmtWord(price - fee)} $WORD, and ${fmtWord(fee)} goes to the Rewards Pool.`
          : `The buyer pays your price. You get ${100 - SALE_FEE * 100}%, and ${SALE_FEE * 100}% goes to the Rewards Pool.`}{" "}
        Listing is a free signature. While it’s for sale, {word.word} earns nothing and has no jackpot entry.
        {listing && " Your old listing is cancelled in the same step."}
        {/* The Customization Spec: taste stays with the player (decisions.md #22). Said only once
            there's a Shop to buy taste in. */}
        {shopEnabled() && " Scenes, cases, and costumes stay with the seller."}
      </p>
      {/* Against the rounded figure the first idea offers, so taking it never reads as too low. */}
      {cost && price > 0 && price < roundPrice(cost.total) && (
        <p className="mt-1 text-xs font-bold text-gold-ink">That’s less than it costs to make, about {fmtWord(cost.total)} $WORD. It’s your call.</p>
      )}
      <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={close}>
        Cancel
      </Button>
    </form>
  );
}
