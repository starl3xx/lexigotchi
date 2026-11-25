"use client";
/**
 * Sell, on the Market itself (decisions.md #28; starl3xx, 2026-11-25: "I should be able to list words
 * and letters both from the Market"). Three parts, top to bottom:
 * - what the player has for sale now, from every wallet of theirs, with a way to take each off sale
 *   (a paused letter listing too: it would go back on sale by itself, at its old price);
 * - their words that can be listed (unstaked, in the connected wallet), each opening the sell form;
 * - their loose letters: tap one, say how many and for how much each.
 *
 * Only the connected wallet signs, so the words and letters offered here are that wallet's.
 */
import { useState } from "react";
import { DEFAULT_PARAMS } from "@/lib/params";
import { MIN_LETTER_PRICE } from "@/lib/onchain/letterSale";
import { roundPrice } from "@/lib/wordCost";
import { isUpperId, letterLabel, letterMakeCost, letterPriceIdeas, lowestOtherAsk } from "@/lib/market/deals";
import { Button } from "../primitives";
import { LetterTile, WordTiles } from "../LetterTile";
import { fmtWord, idxToChar, mineLower, mineUpper, useGame } from "../state";
import { shortAddress } from "../useWorld";
import { byBest } from "../stagePick";
import { SellWord } from "./SellWord";
import { Part, PriceIdeas, PriceInput, Qty, Versus, priceOf, priceText, useAmount } from "./bits";

const LETTER_FEE = DEFAULT_PARAMS.market.letterSaleFee;

export function SellDesk({ letter, setLetter }: { letter: number | null; setLetter: (letterId: number | null) => void }) {
  const g = useGame();
  const { state } = g;
  const [word, setWord] = useState<string | null>(null);

  const myWordListings = g.wordBoard.filter((l) => g.market.isMine(l.maker));
  const listed = new Set(myWordListings.map((l) => l.word));
  const sellable = state.words.filter((w) => w.mine && !w.staked && !listed.has(w.word)).sort(byBest);
  const staked = state.words.filter((w) => w.mine && w.staked).length;
  const tray = [
    ...mineUpper(state).map((c, i) => ({ id: i + 26, c })),
    ...mineLower(state).map((c, i) => ({ id: i, c })),
  ].filter((x) => x.c > 0);
  const nothingListed = myWordListings.length === 0 && g.market.myLetters.length === 0 && g.market.oldSwaps.length === 0;

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:gap-y-6 lg:space-y-0">
      <Part title="For sale by you" className="lg:col-span-2">
        {nothingListed ? (
          <p className="text-sm text-ink/55">Nothing of yours is for sale. Pick a word or a letter below.</p>
        ) : (
          <ul className="divide-y-2 divide-dashed divide-ink/15">
            {myWordListings.map((l) => (
              <li key={l.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <WordTiles word={l.word} upper={l.upper} size={22} still />
                  <span className="text-sm">
                    <strong className="font-display tabular-nums">{fmtWord(l.price)}</strong> <span className="text-xs text-ink/60">$WORD</span>
                  </span>
                </span>
                {g.market.isHere(l.maker) ? (
                  <button type="button" onClick={() => g.cancelWordListing(l.orderHash)} className="shrink-0 text-xs font-bold text-ink/55 underline">
                    Take off sale
                  </button>
                ) : (
                  <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">From {shortAddress(l.maker)}. Switch to it to change it.</span>
                )}
              </li>
            ))}
            {g.market.myLetters.map((l) => (
              <li key={l.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <LetterTile char={letterLabel(l.letterId)} upper={isUpperId(l.letterId)} size={34} count={l.unsold} dim={l.state === "paused"} />
                  <span className="min-w-0 text-sm">
                    <strong className="font-display tabular-nums">{fmtWord(l.unitPrice)}</strong> <span className="text-xs text-ink/60">$WORD each</span>
                    <span className="block text-xs text-ink/60">
                      {l.state === "live"
                        ? l.available < l.unsold
                          ? `${l.available} of ${l.unsold} can sell now: the wallet holds ${l.available}.`
                          : `${l.unsold} of ${l.qty} left to sell.`
                        : "Paused: the wallet holds none now. It goes back on sale by itself, at this price, if it holds one again."}
                    </span>
                  </span>
                </span>
                {g.market.isHere(l.maker) ? (
                  <span className="flex shrink-0 flex-col items-end gap-1 text-xs font-bold">
                    {l.state === "live" && (
                      <button type="button" onClick={() => setLetter(l.letterId)} className="text-teal-ink underline">
                        Change
                      </button>
                    )}
                    <button type="button" onClick={() => g.market.cancelLetterListing(l.orderHash)} className="text-ink/55 underline">
                      Take off sale
                    </button>
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">From {shortAddress(l.maker)}. Switch to it to change it.</span>
                )}
              </li>
            ))}
            {g.market.oldSwaps.map((o) => (
              <li key={o.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <LetterTile char={idxToChar(o.giveId % 26)} upper={o.giveId >= 26} size={30} />
                  <span className="text-ink/55">for</span>
                  <LetterTile char={idxToChar(o.wantId % 26)} upper={o.wantId >= 26} size={30} />
                  <span className="text-xs text-ink/60">An old letter swap. Swaps are closed, but this one can still be taken until you cancel it.</span>
                </span>
                {g.market.isHere(o.maker) ? (
                  <button type="button" onClick={() => g.market.cancelOldSwap(o.orderHash)} className="shrink-0 text-xs font-bold text-ink/55 underline">
                    Cancel
                  </button>
                ) : (
                  <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">From {shortAddress(o.maker)}. Switch to it to cancel.</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part title="Sell a word" aside={sellable.length > 0 ? `${sellable.length} you can list` : undefined}>
        {sellable.length === 0 ? (
          <p className="text-sm text-ink/55">
            {staked > 0
              ? "Your words are all staked. Unstake one in your bag to sell it: only a word in your wallet can be sold."
              : "No words in this wallet to sell."}
          </p>
        ) : (
          <ul className="divide-y-2 divide-dashed divide-ink/15">
            {sellable.map((w) => (
              <li key={w.word} className="py-2">
                {word === w.word ? (
                  <>
                    <div className="mb-2">
                      <WordTiles word={w.word} upper={w.upper} size={26} tier={w.tier} still />
                    </div>
                    <SellWord word={w} startOpen onClose={() => setWord(null)} />
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <WordTiles word={w.word} upper={w.upper} size={26} tier={w.tier} still />
                    <Button size="sm" variant="ghost" onClick={() => setWord(w.word)}>
                      Sell
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {sellable.length > 0 && staked > 0 && (
          <p className="mt-2 text-xs text-ink/55">
            {staked} more {staked === 1 ? "is" : "are"} staked. Unstake a word to sell it.
          </p>
        )}
      </Part>

      <Part title="Sell letters" aside={tray.length > 0 ? "Tap a letter" : undefined}>
        {g.market.lettersClosed ? (
          <p className="text-sm text-ink/55">Letters open for sale here shortly.</p>
        ) : tray.length === 0 ? (
          <p className="text-sm text-ink/55">No loose letters in this wallet to sell.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {tray.map(({ id, c }) => (
                <LetterTile key={id} char={letterLabel(id)} upper={isUpperId(id)} count={c} size={40} selected={letter === id} onClick={() => setLetter(letter === id ? null : id)} />
              ))}
            </div>
            {letter !== null && tray.some((t) => t.id === letter) ? (
              <SellLetters key={letter} letterId={letter} onDone={() => setLetter(null)} />
            ) : (
              <p className="mt-2 text-xs text-ink/55">
                List one letter or several at a price each. They stay in your bag until they sell, and a buyer can take any number of them.
              </p>
            )}
          </>
        )}
      </Part>
    </div>
  );
}

function SellLetters({ letterId, onDone }: { letterId: number; onDone: () => void }) {
  const g = useGame();
  const amount = useAmount();
  const name = letterLabel(letterId);
  const held = (isUpperId(letterId) ? mineUpper(g.state) : mineLower(g.state))[letterId % 26] ?? 0;
  const current = g.market.myLetters.find((l) => l.letterId === letterId && g.market.isHere(l.maker));
  const [qty, setQty] = useState(Math.min(held, current?.unsold ?? 1));
  const [text, setText] = useState(current ? priceText(current.unitPrice) : "");
  const [busy, setBusy] = useState(false);
  const price = priceOf(text);
  const fee = Math.ceil(price * LETTER_FEE);
  const make = letterMakeCost(letterId, { pack: g.price("pack"), roll: g.price("roll") });
  const lowest = lowestOtherAsk(g.market.letterBook, letterId, g.market.isMine);
  const ideas = letterPriceIdeas({ makeCost: make, lowestAsk: lowest, stat: g.market.letterStats[letterId], minPrice: MIN_LETTER_PRICE });
  const count = Math.min(qty, held);
  return (
    <form
      className="mt-3 rounded-xl border-2 border-ink bg-card px-3 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || price <= 0 || count < 1) return;
        setBusy(true);
        const ok = await g.market.listLetters(letterId, count, price);
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-sm font-extrabold">
          How many {name}
          {held > 1 ? `, of your ${held}` : ""}
        </span>
        <span className="flex items-center gap-2">
          <Qty value={count} max={held} onChange={setQty} label={`How many ${name}`} />
          {held > 2 && count < held && (
            <button type="button" onClick={() => setQty(held)} className="text-xs font-bold text-teal-ink underline">
              All {held}
            </button>
          )}
        </span>
      </div>

      <div className="mt-3">
        <PriceIdeas ideas={ideas} current={price} onPick={(n) => setText(priceText(n))} />
      </div>
      <label className="mt-3 block text-xs font-bold text-ink/60" htmlFor={`sell-letter-${letterId}`}>
        {current ? "New price for each, in $WORD" : "Price for each, in $WORD"}
      </label>
      <div className="mt-1 flex gap-2">
        <PriceInput id={`sell-letter-${letterId}`} value={text} onChange={setText} placeholder={priceText(Math.max(MIN_LETTER_PRICE, roundPrice(make)))} />
        <Button size="sm" variant="teal" type="submit" disabled={busy || price <= 0 || count < 1}>
          {current ? "Set it" : `List ${count} × ${name}`}
        </Button>
      </div>
      {price > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-2 text-xs">
          {lowest !== undefined && <Versus price={price} reference={lowest} what={`the lowest ${name} for sale`} />}
          <Versus price={price} reference={make} />
        </p>
      )}
      <p className="mt-2 text-xs text-ink/60">
        {price > 0
          ? `A buyer pays ${amount(price)} for each. You get ${fmtWord(price - fee)} $WORD for each${count > 1 ? `, ${fmtWord((price - fee) * count)} for all ${count}` : ""}, and ${fmtWord(fee)} of each goes to the Rewards Pool.`
          : `A buyer pays your price for each letter. You get ${100 - LETTER_FEE * 100}%, and ${LETTER_FEE * 100}% goes to the Rewards Pool.`}{" "}
        Listing is a free signature. Listed letters stay in your bag until they sell: spell or move one, and the listing gets smaller.
        {current && " Your old listing is cancelled in the same step."}
      </p>
      <button type="button" onClick={onDone} className="mt-1 text-xs font-bold text-ink/45 underline">
        Not now
      </button>
    </form>
  );
}

