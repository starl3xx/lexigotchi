"use client";
/**
 * Letters for sale (decisions.md #29): the shelf, and the counter under it.
 *
 * The shelf is the whole alphabet, each letter with a price tag when someone is selling it (the
 * lowest price, and how many). Letters of a kind are alike, so however many listings there are, a
 * player reads 26 tags. Tapping a letter opens its counter: who is selling it, lowercase and
 * UPPERCASE apart, cheapest first, each with how many to take and what that costs.
 *
 * Beside each price stands what the letter costs to make (its share of a pack; an UPPERCASE letter
 * adds the average rolls) and what one last sold for, so a price has something to be read against.
 */
import { useEffect, useRef, useState } from "react";
import { ALPHABET } from "@/lib/economy";
import { isUpperId, letterLabel, letterMakeCost, letterStalls } from "@/lib/market/deals";
import type { LetterAsk, LetterBook } from "@/lib/market/types";
import { Button } from "../primitives";
import { LetterTile } from "../LetterTile";
import { PlayerChip } from "../PlayerChip";
import { fmtWord, mineLower, mineUpper, useGame } from "../state";
import { Qty, Versus, timeAgo, useAmount } from "./bits";

export function LettersBoard({
  open,
  setOpen,
  short,
  flagged,
  onSell,
}: {
  /** The letter whose counter is open (0-25), or null. */
  open: number | null;
  setOpen: (index: number | null) => void;
  /** Words the bag is one letter short of, by the letter that finishes them. */
  short: ReadonlyMap<number, string[]>;
  /** The letters among the player's picks (0-25): the only ones the shelf flags, or every tag would carry one. */
  flagged: ReadonlySet<number>;
  /** Go sell this letter id instead. */
  onSell: (letterId: number) => void;
}) {
  const g = useGame();
  const stalls = letterStalls(g.market.letterBook);
  const forSale = stalls.filter((s) => s.lowest !== undefined).length;
  const counter = useRef<HTMLDivElement>(null);
  // A tap on the shelf opens the counter under it; on a phone that may be below the screen.
  useEffect(() => {
    if (open !== null) counter.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <div>
      <p className="mb-2 text-sm text-ink/60">
        {g.market.loading
          ? "Reading the shelf…"
          : forSale === 0
            ? "No letters are for sale right now. Yours could be the first on the shelf."
            : "Each tag is the lowest price for that letter, and how many are for sale. Tap a letter to see who’s selling it."}
      </p>
      <div className="grid grid-cols-7 gap-y-4 md:grid-cols-[repeat(13,minmax(0,1fr))]" role="group" aria-label="Letters for sale">
        {stalls.map((s) => {
          const ch = ALPHABET[s.index];
          const finishes = flagged.has(s.index) ? short.get(s.index) : undefined;
          // The shelf stands the lowercase letter up, unless only raised ones are for sale.
          const upperOnly = !s.lower && !!s.upper;
          return (
            <button
              key={ch}
              type="button"
              className="mk-slot"
              aria-pressed={open === s.index}
              aria-label={
                s.lowest !== undefined
                  ? `${ch.toLowerCase()}: ${s.available} for sale, from ${fmtWord(s.lowest)} $WORD${finishes ? `. Finishes ${finishes[0]}` : ""}`
                  : `${ch.toLowerCase()}: none for sale`
              }
              onClick={() => setOpen(open === s.index ? null : s.index)}
            >
              <span className="relative">
                <LetterTile char={upperOnly ? ch : ch.toLowerCase()} upper={upperOnly} size={38} dim={s.lowest === undefined} />
                {finishes && s.lowest !== undefined && (
                  <span aria-hidden className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border-2 border-ink bg-candy text-[9px] font-extrabold leading-none text-paper">
                    !
                  </span>
                )}
              </span>
              <span className="mk-plank" />
              {s.lowest !== undefined ? (
                <span className="mk-tag">
                  <span className="block font-display text-[11px] font-extrabold tabular-nums">{fmtWord(s.lowest)}</span>
                  <span className="block text-[10px] opacity-70">×{s.available}</span>
                </span>
              ) : (
                <span className="mt-[9px] block h-[38px]" />
              )}
            </button>
          );
        })}
        {/* 26 letters in rows of 7 leave two places: the plank runs on, so the last row is a whole shelf. */}
        {[0, 1].map((k) => (
          <span key={k} className="mk-slot md:hidden" aria-hidden>
            {/* An unseen tile, so the plank sits exactly where its neighbors' do. */}
            <span className="invisible">
              <LetterTile char="a" size={38} />
            </span>
            <span className="mk-plank" />
          </span>
        ))}
      </div>

      <div ref={counter} className="scroll-mb-24">
        {open !== null && <Counter index={open} lower={stalls[open].lower} upper={stalls[open].upper} finishes={short.get(open)} onSell={onSell} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}

/** One letter's listings: lowercase, then UPPERCASE, cheapest first. */
function Counter({
  index,
  lower,
  upper,
  finishes,
  onSell,
  onClose,
}: {
  index: number;
  lower?: LetterBook;
  upper?: LetterBook;
  finishes?: string[];
  onSell: (letterId: number) => void;
  onClose: () => void;
}) {
  const g = useGame();
  const ch = ALPHABET[index];
  const heldLower = mineLower(g.state)[index] ?? 0;
  const heldUpper = mineUpper(g.state)[index] ?? 0;
  const none = !lower && !upper;
  return (
    <div className="mt-4 rounded-2xl border-[3px] border-ink bg-card px-3 py-3 [box-shadow:4px_4px_0_#1b1714]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <LetterTile char={ch.toLowerCase()} size={52} />
          <div className="min-w-0">
            <h3 className="font-display text-lg font-extrabold leading-tight">
              {none ? `No ${ch.toLowerCase()} for sale` : `Who’s selling ${ch.toLowerCase()}`}
            </h3>
            {finishes && finishes.length > 0 && (
              <p className="text-xs font-bold text-candy-ink">
                One more {ch.toLowerCase()} finishes {finishes[0]}
                {finishes.length > 1 ? ` and ${finishes.length - 1} more word${finishes.length === 2 ? "" : "s"} you’re one letter short of` : ", a word you’re one letter short of"}.
              </p>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-xs font-bold text-ink/45 underline">
          Close
        </button>
      </div>

      <Asks letterId={index} book={lower} />
      <Asks letterId={index + 26} book={upper} />

      {(heldLower > 0 || heldUpper > 0) && (
        <p className="mt-3 border-t-2 border-dashed border-ink/20 pt-2 text-xs text-ink/60">
          You hold {heldLower > 0 && `${heldLower} × ${ch.toLowerCase()}`}
          {heldLower > 0 && heldUpper > 0 && " and "}
          {heldUpper > 0 && `${heldUpper} × ${ch}`}.{" "}
          <button type="button" className="font-bold text-teal-ink underline" onClick={() => onSell(heldLower > 0 ? index : index + 26)}>
            Sell some
          </button>
        </p>
      )}
    </div>
  );
}

function Asks({ letterId, book }: { letterId: number; book?: LetterBook }) {
  const g = useGame();
  const amount = useAmount();
  const [extra, setExtra] = useState<{ asks: LetterAsk[]; more: boolean; next: number } | null>(null);
  const [loading, setLoading] = useState(false);
  // A new board read replaces the first page: drop the deeper pages, which may now overlap it.
  useEffect(() => setExtra(null), [book]);
  if (!book) return null;
  const make = letterMakeCost(letterId, { pack: g.price("pack"), roll: g.price("roll") });
  const stat = g.market.letterStats[letterId];
  const seen = new Set(book.asks.map((a) => a.orderHash));
  const asks = [...book.asks, ...(extra?.asks ?? []).filter((a) => !seen.has(a.orderHash))];
  const more = extra ? extra.more : book.more;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b-2 border-ink pb-1">
        <h4 className="font-display text-sm font-extrabold">{isUpperId(letterId) ? `UPPERCASE ${letterLabel(letterId)}` : `lowercase ${letterLabel(letterId)}`}</h4>
        <span className="text-xs text-ink/60">
          About {fmtWord(make)} to make{stat ? `. Last sold for ${fmtWord(stat.last)}, ${timeAgo(stat.lastAt)}` : ""}.
        </span>
      </div>
      <ul className="divide-y-2 divide-dashed divide-ink/15">
        {asks.map((a, i) => (
          <AskRow key={a.orderHash} ask={a} make={make} best={i === 0 && asks.length > 1} amount={amount} />
        ))}
      </ul>
      {more && (
        <button
          type="button"
          disabled={loading}
          className="mt-1 text-xs font-bold text-teal-ink underline disabled:text-ink/40"
          onClick={async () => {
            setLoading(true);
            const page = await g.market.moreAsks(letterId, extra?.next ?? book.asks.length);
            setExtra((prev) => ({ asks: [...(prev?.asks ?? []), ...page.asks], more: page.more, next: page.next }));
            setLoading(false);
          }}
        >
          {loading ? "Reading…" : "Show more sellers"}
        </button>
      )}
    </div>
  );
}

function AskRow({ ask, make, best, amount }: { ask: LetterAsk; make: number; best: boolean; amount: (n: number) => string }) {
  const g = useGame();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const mine = g.market.isMine(ask.maker);
  const take = Math.min(count, ask.available);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="font-display text-base tabular-nums">{fmtWord(ask.unitPrice)}</strong>
          <span className="text-xs text-ink/60">$WORD each</span>
          {best && <span className="rounded-full bg-teal/25 px-1.5 py-0.5 text-[10px] font-extrabold text-teal-ink">Lowest</span>}
          {mine && <span className="rounded-full border-2 border-ink bg-gold/30 px-1.5 text-[10px] font-extrabold">Yours</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
          <span>{ask.available} for sale</span>
          <Versus price={ask.unitPrice} reference={make} />
        </div>
        {!mine && (
          <span className="mt-1 block text-xs text-ink/60">
            <PlayerChip address={ask.maker} profile={g.market.faces[ask.maker]} size={18} />
          </span>
        )}
      </div>
      {mine ? (
        g.market.isHere(ask.maker) ? (
          <button type="button" onClick={() => g.market.cancelLetterListing(ask.orderHash)} className="shrink-0 text-xs font-bold text-ink/55 underline">
            Take off sale
          </button>
        ) : (
          <span className="shrink-0 text-right text-[11px] leading-tight text-ink/50">From another of your wallets.</span>
        )
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {ask.available > 1 && <Qty value={take} max={ask.available} onChange={setCount} label="How many" />}
          <Button
            size="sm"
            variant="teal"
            disabled={busy}
            title={amount(ask.unitPrice * take)}
            onClick={async () => {
              setBusy(true);
              await g.market.buyLetters(ask, take);
              setBusy(false);
              setCount(1);
            }}
          >
            Buy {take > 1 ? `${take} for ${fmtWord(ask.unitPrice * take)}` : `for ${fmtWord(ask.unitPrice)}`}
          </Button>
        </div>
      )}
    </li>
  );
}
