"use client";
/**
 * Sell, on the Market itself (decisions.md #30; starl3xx, 2026-11-25: "I should be able to list words
 * and letters both from the Market"). Two parts:
 * - **what to sell**: a switch between the player's words and their loose letters, each one tap from
 *   the other. They used to be stacked, words first, and a player with several words never found
 *   their letters under them ("where do i see my loose letters to list for sale?", the same day).
 *   A word opens the sell form; a letter asks how many and for how much each.
 * - **what they have for sale now**, from every wallet of theirs, with a way to take each off sale
 *   (a paused letter listing too: it would go back on sale by itself, at its old price).
 *
 * Only the connected wallet signs, so the words and letters offered here are that wallet's; letters
 * in the player's other wallets are counted, with the way to bring them here.
 */
import { useState } from "react";
import { DEFAULT_PARAMS } from "@/lib/params";
import { MIN_LETTER_PRICE } from "@/lib/onchain/letterSale";
import { roundPrice } from "@/lib/wordCost";
import { isUpperId, letterLabel, letterMakeCost, letterPriceIdeas, lowestOtherAsk } from "@/lib/market/deals";
import { Button, Segmented } from "../primitives";
import { LetterTile, WordTiles } from "../LetterTile";
import { fmtWord, idxToChar, mineLower, mineUpper, useGame } from "../state";
import { shortAddress } from "../useWorld";
import { byBest } from "../stagePick";
import { SellWord } from "./SellWord";
import { ReminderToggle } from "../ReminderToggle";
import { FormHead, Part, PriceHint, PriceIdeas, PriceInput, Qty, Versus, priceOf, priceText, useAmount } from "./bits";

const LETTER_FEE = DEFAULT_PARAMS.market.letterSaleFee;

export type SellKind = "words" | "letters";

export function SellDesk({
  kind,
  setKind,
  letter,
  setLetter,
}: {
  /** Which of the player's things the page shows to sell. */
  kind: SellKind;
  setKind: (kind: SellKind) => void;
  /** The letter id whose form is open, or null. */
  letter: number | null;
  setLetter: (letterId: number | null) => void;
}) {
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
  const here = tray.reduce((n, t) => n + t.c, 0);
  // Letters in the player's other wallets: in the bag, but only their own wallet can list them.
  const elsewhere = state.lower.reduce((a, b) => a + b, 0) + state.upper.reduce((a, b) => a + b, 0) - here;
  const nothingListed = myWordListings.length === 0 && g.market.myLetters.length === 0 && g.market.oldSwaps.length === 0;

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:space-y-0">
      <div data-section="sellLetters">
        <Segmented
          className="mb-3"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setWord(null);
            setLetter(null);
          }}
          options={[
            { value: "words", label: `Your words · ${sellable.length}` },
            { value: "letters", label: `Your letters · ${here}` },
          ]}
        />
        {kind === "words" && (
          <div>
            {sellable.length === 0 ? (
              <p className="text-sm text-ink/70">
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
                        <div className="mb-2 flex justify-start">
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
              <p className="mt-2 text-xs text-ink/70">
                {staked} more {staked === 1 ? "is" : "are"} staked. Unstake a word to sell it.
              </p>
            )}
          </div>
        )}
        {kind === "letters" && (
          <div>
            {g.market.lettersClosed ? (
              <p className="text-sm text-ink/70">Letters open for sale here shortly.</p>
            ) : tray.length === 0 ? (
              <p className="text-sm text-ink/70">
                {elsewhere > 0 ? "No loose letters in this wallet." : "No loose letters to sell. Letters inside a word go with the word."}
              </p>
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
                  <p className="mt-2 text-xs text-ink/70">
                    Tap a letter to sell it: one or several, at a price each. They stay in your bag until they sell, and a buyer can take any number
                    of them.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {kind === "letters" && elsewhere > 0 && !g.market.lettersClosed && (
          <p className="mt-2 text-xs text-ink/70">
            {elsewhere} more {elsewhere === 1 ? "is" : "are"} in your other wallets. Only the wallet that holds a letter can list it: switch to that
            wallet, or{" "}
            <button type="button" className="font-medium text-teal-ink underline" onClick={() => g.openSheet({ kind: "profile", focus: "move" })}>
              move them here
            </button>
            .
          </p>
        )}
      </div>

      <Part title="For sale by you">
        {nothingListed ? (
          <p className="text-sm text-ink/70">Nothing of yours is for sale yet.</p>
        ) : (
          <ul className="divide-y-2 divide-dashed divide-ink/15">
            {myWordListings.map((l) => (
              <li key={l.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <WordTiles word={l.word} upper={l.upper} size={22} still />
                  <span className="text-sm">
                    <span className="fig">{fmtWord(l.price)}</span> <span className="text-xs text-ink/70">$WORD</span>
                  </span>
                </span>
                {g.market.isHere(l.maker) ? (
                  <button type="button" onClick={() => g.cancelWordListing(l.orderHash)} className="shrink-0 text-xs font-medium text-ink/70 underline">
                    Take off sale
                  </button>
                ) : (
                  <span className="shrink-0 text-right text-xs leading-tight text-ink/70">From {shortAddress(l.maker)}. Switch to it to change it.</span>
                )}
              </li>
            ))}
            {g.market.myLetters.map((l) => (
              <li key={l.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <LetterTile char={letterLabel(l.letterId)} upper={isUpperId(l.letterId)} size={34} count={l.unsold} dim={l.state === "paused"} />
                  <span className="min-w-0 text-sm">
                    <span className="fig">{fmtWord(l.unitPrice)}</span> <span className="text-xs text-ink/70">$WORD each</span>
                    <span className="block text-xs text-ink/70">
                      {l.state === "live"
                        ? l.available < l.unsold
                          ? `${l.available} of ${l.unsold} can sell now: the wallet holds ${l.available}.`
                          : `${l.unsold} of ${l.qty} left to sell.`
                        : "Paused: the wallet holds none now. It goes back on sale by itself, at this price, if it holds one again."}
                    </span>
                  </span>
                </span>
                {g.market.isHere(l.maker) ? (
                  <span className="flex shrink-0 flex-col items-end gap-1 text-xs font-medium">
                    {l.state === "live" && (
                      <button
                        type="button"
                        // The form lives on the letters tab: go there, or Change does nothing from Your words (Bugbot on #221).
                        onClick={() => {
                          setKind("letters");
                          setWord(null);
                          setLetter(l.letterId);
                        }}
                        className="text-teal-ink underline"
                      >
                        Change
                      </button>
                    )}
                    <button type="button" onClick={() => g.market.cancelLetterListing(l.orderHash)} className="text-ink/70 underline">
                      Take off sale
                    </button>
                  </span>
                ) : (
                  <span className="shrink-0 text-right text-xs leading-tight text-ink/70">From {shortAddress(l.maker)}. Switch to it to change it.</span>
                )}
              </li>
            ))}
            {g.market.oldSwaps.map((o) => (
              <li key={o.orderHash} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <LetterTile char={idxToChar(o.giveId % 26)} upper={o.giveId >= 26} size={30} />
                  <span className="text-ink/70">for</span>
                  <LetterTile char={idxToChar(o.wantId % 26)} upper={o.wantId >= 26} size={30} />
                  <span className="text-xs text-ink/70">An old letter swap. Swaps are closed, but this one can still be taken until you cancel it.</span>
                </span>
                {g.market.isHere(o.maker) ? (
                  <button type="button" onClick={() => g.market.cancelOldSwap(o.orderHash)} className="shrink-0 text-xs font-medium text-ink/70 underline">
                    Cancel
                  </button>
                ) : (
                  <span className="shrink-0 text-right text-xs leading-tight text-ink/70">From {shortAddress(o.maker)}. Switch to it to cancel.</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* Asked where the reason is on screen: something is for sale. It renders nothing where
            browser reminders can't exist, or once they are on (ReminderToggle). */}
        {!nothingListed && <ReminderToggle compact label="Tell me when something sells" />}
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
      <FormHead title={current ? `Change your ${name} listing` : `Sell ${name}`} onClose={onDone} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-medium text-ink/70">
          How many{held > 1 ? `, of your ${held}` : ""}
        </span>
        <span className="flex items-center gap-2">
          <Qty value={count} max={held} onChange={setQty} label={`How many ${name}`} />
          {held > 2 && count < held && (
            <button type="button" onClick={() => setQty(held)} className="text-xs font-medium text-teal-ink underline">
              All {held}
            </button>
          )}
        </span>
      </div>

      <div className="mt-3">
        <PriceIdeas ideas={ideas} current={price} onPick={(n) => setText(priceText(n))} />
      </div>
      <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor={`sell-letter-${letterId}`}>
        {current ? "New price for each, in $WORD" : "Price for each, in $WORD"}
      </label>
      <div className="mt-1 flex gap-2">
        <PriceInput id={`sell-letter-${letterId}`} value={text} onChange={setText} placeholder={priceText(Math.max(MIN_LETTER_PRICE, roundPrice(make)))} />
        <Button size="sm" variant="teal" type="submit" disabled={busy || price <= 0 || count < 1}>
          {current ? "Set it" : `List ${count} × ${name}`}
        </Button>
      </div>
      <PriceHint text={text} />
      {price > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-2 text-xs">
          {lowest !== undefined && <Versus price={price} reference={lowest} what={`the lowest ${name} for sale`} />}
          <Versus price={price} reference={make} />
        </p>
      )}
      <p className="mt-2 text-xs text-ink/70">
        {price > 0
          ? `A buyer pays ${amount(price)} for each. You get ${fmtWord(price - fee)} $WORD for each${count > 1 ? `, ${fmtWord((price - fee) * count)} for all ${count}` : ""}, and ${fmtWord(fee)} of each goes to the Rewards Pool.`
          : `A buyer pays your price for each letter. You get ${100 - LETTER_FEE * 100}%, and ${LETTER_FEE * 100}% goes to the Rewards Pool.`}{" "}
        Listing is a free signature. Listed letters stay in your bag until they sell: spell or move one, and the listing gets smaller.
        {current && " Your old listing is cancelled in the same step."}
      </p>
      <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

