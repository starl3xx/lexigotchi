"use client";
/** Word detail — stake, feed, raise letters to UPPERCASE, ascend (prestige), sell, or dissolve. */
import { useState } from "react";
import { Button, Card, HungerBadge, Sheet, TierBadge } from "../primitives";
import { CaseBadge, LetterTile, PrestigeStars, WordTiles, careState } from "../LetterTile";
import { CaretRight, Check, Coins, Cookie, Crown, Star, Ticket } from "../ui/icons";
import { promptAccountSwitch } from "../walletSwitch";
import { useAccount } from "wagmi";
import { usePublicProfile } from "../useProfile";
import {
  fmtUsd,
  fmtWord,
  showsUsd,
  hunger,
  idxToChar,
  jackpotEligible,
  useGame,
  wordCase,
  type Hunger,
  type OwnedWord,
} from "../state";
import { careNote } from "../careNote";
import { DEFAULT_PARAMS } from "@/lib/params";
import { useEatingFlash } from "../useEatingFlash";
import { earningLine, earningStatus, payoutWhen } from "../earnings";

export function WordSheet({ word: wordKey }: { word: string }) {
  const g = useGame();
  const { state } = g;
  // Staking ties a word to this wallet: only the staker can feed it. Say so before a player stakes
  // from a wallet that isn't their game wallet (lib/db/gameWallet.ts).
  const { address } = useAccount();
  const gameWallet = usePublicProfile().profile?.gameWallet ?? null;
  const offGameWallet = Boolean(gameWallet && address && gameWallet !== address.toLowerCase());
  const word = state.words.find((w) => w.word === wordKey);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  // Guards against a second tap during the async chain flow — each tap is a PAID commit.
  const [ascending, setAscending] = useState(false);
  const [strandedNote, setStrandedNote] = useState("");
  // The tiles chew for a moment when a feed lands (useEatingFlash).
  const eating = useEatingFlash(wordKey, word ? hunger(word) : "fed");

  if (!word) {
    return (
      <Sheet open onClose={g.closeSheet} title="Word">
        <p className="py-6 text-center text-ink/60">This word is no longer in your bag.</p>
      </Sheet>
    );
  }

  const c = wordCase(word);
  const h = hunger(word);
  const fullyRaised = c === "UPPERCASE";
  const isAnswer = state.jackpotWord === word.word && !state.jackpotRevealed;
  const maxLevel = g.maxPrestigeLevel;
  const canPrestige = fullyRaised && word.staked && word.prestigeLevel < maxLevel;
  const snack = g.price("snack");
  const snackShort =
    word.staked && word.daysUnfed > 0 && state.freeSnackUsed && !g.canAfford(snack)
      ? ` A snack costs ${fmtWord(snack)} $WORD, and you don’t have enough.`
      : null;
  const { note, feedOff } = careNote(word, h, { snackShort, nowSec: Math.floor(Date.now() / 1000) });

  return (
    <Sheet
      open
      onClose={g.closeSheet}
      title={
        <span className="flex items-center gap-1.5">
          {word.word} <PrestigeStars level={word.prestigeLevel} />
        </span>
      }
    >
      {/* hero — the word as a row of tiles wearing the word's current care state */}
      <div className={`mb-3 flex justify-center rounded-2xl border-[3px] border-ink py-5 ${fullyRaised ? "bg-gold/15" : "bg-paper-dark/40"}`}>
        <WordTiles word={word.word} upper={word.upper} size={54} state={eating ? "eating" : careState(word)} gild={word.prestigeLevel} detail="bust" />
      </div>

      {/* status */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <TierBadge tier={word.tier} />
        <CaseBadge word={word} />
        {word.staked ? <HungerBadge state={h} /> : null}
        {word.staked && jackpotEligible(word) && (
          <span className="inline-flex items-center gap-0.5 text-xs text-teal-ink">
            <Ticket weight="fill" size={12} /> in the jackpot
          </span>
        )}
      </div>

      {/* earnings: what this word has earned for the player, and what would make it earn */}
      <EarningsRow word={word} h={h} />

      {isAnswer && jackpotEligible(word) && (
        <Card className="mb-3 bg-candy/10">
          <div className="text-sm">
            <strong className="font-display">You may hold today’s secret word</strong>, staked and fed.
            <button onClick={() => g.nav("jackpot")} className="ml-1 font-bold text-candy-ink underline">
              Open the jackpot →
            </button>
          </div>
        </Card>
      )}

      {/* union-bag word held by a linked wallet — yours to admire, not to sign for. Every verb
          below (stake, feed, roll, ascend, dissolve) acts on msg.sender's assets, so the sheet
          says where it lives instead of offering buttons that would build guaranteed reverts. */}
      {!word.mine && (
        <Card className="mb-3 border-gold bg-gold/10 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              {word.care ? (
                <>
                  {/* Staking.setCaretaker: the staker named this wallet; feed, roll, and ascend here. */}
                  <strong className="font-display">
                    Staked by {word.holder ? `${word.holder.slice(0, 6)}…${word.holder.slice(-4)}` : "your other wallet"}.
                  </strong>{" "}
                  This wallet takes care of it: you can feed, roll, and ascend it here, paying from this wallet. Only that
                  wallet can unstake it.
                </>
              ) : (
                <>
                  <strong className="font-display">Held by {word.holder ? `${word.holder.slice(0, 6)}…${word.holder.slice(-4)}` : "a linked wallet"}.</strong>{" "}
                  It’s part of your bag. Switch to that wallet to stake, feed, or raise it.
                </>
              )}
            </div>
            {/* Opens the wallet's own account picker — the app can't choose the account, but it
                can put the choice one tap away. wagmi follows accountsChanged, and `mine`
                re-attributes across the whole bag the moment the switch lands. */}
            <Button variant="teal" onClick={() => void promptAccountSwitch()}>
              Switch
            </Button>
          </div>
        </Card>
      )}

      {/* care: the label says what staking buys THIS word, and the note says why Feed is off */}
      <div className={`grid grid-cols-2 gap-2 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
        <Button
          variant={word.staked ? "ghost" : "teal"}
          disabled={!word.mine}
          title={word.mine ? undefined : "Only the wallet that staked it can unstake it"}
          onClick={() => g.toggleStake(word.word)}
        >
          {word.staked ? "Unstake" : fullyRaised ? "Stake to earn" : "Stake for jackpot"}
        </Button>
        <Button
          variant="teal"
          disabled={feedOff !== null}
          title={feedOff ?? undefined}
          onClick={() => g.feed(word.word)}
        >
          <Cookie weight="fill" /> Feed {word.staked && h === "fed" && <Check weight="bold" size={14} />}
        </Button>
      </div>
      {word.mine && !word.staked && offGameWallet && (
        <p className="mt-2 text-xs font-bold text-candy-ink">
          This isn’t your game wallet. Once staked here, only this wallet, and the caretakers it names, can feed {word.word}.
        </p>
      )}
      {word.mine && <p className="mb-3 mt-2 text-xs text-ink/60">{note}</p>}
      {word.care && <p className="mb-3 mt-2 text-xs text-ink/60">{note}</p>}
      {!word.mine && !word.care && <div className="mb-3" />}

      {/* raise letters: the owner, or a caretaker of a staked word (Rolls.commitWordRoll) */}
      <Card className={`mb-3 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display font-extrabold">Raise to UPPERCASE</span>
          <span className="text-xs text-ink/55">{word.upper.filter(Boolean).length}/5 · earns $WORD at 5/5</span>
        </div>
        {fullyRaised ? (
          <div className="flex items-center justify-center gap-1 rounded-xl bg-gold/15 py-2 text-center text-sm font-bold text-gold-ink">
            Fully raised <Crown weight="fill" />
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            {[...word.word].map((ch, i) =>
              word.upper[i] ? (
                <LetterTile key={i} char={ch} upper size={42} />
              ) : (
                <LetterTile
                  key={i}
                  char={ch}
                  size={42}
                  onClick={() => g.openSheet({ kind: "roll", target: { kind: "word", word: word.word, pos: i } })}
                  title={`raise ${ch}`}
                />
              ),
            )}
          </div>
        )}
        {!fullyRaised && <p className="mt-2 text-center text-xs text-ink/55">tap a lowercase letter to roll it · {fmtWord(g.price("roll"))} $WORD</p>}
      </Card>

      {/* prestige: hidden entirely while the contract has it switched off (maxLevel 0) */}
      {fullyRaised && maxLevel > 0 && (
        <Card className={`mb-3 bg-gradient-to-b from-card to-gold/10 ${word.mine || word.care ? "" : "pointer-events-none opacity-40"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1 font-display font-extrabold">
                Ascend <Star weight="fill" size={14} className="text-gold-ink" />
              </div>
              <div className="text-xs text-ink/55">
                Gilded L{word.prestigeLevel}
                {word.prestigeLevel < maxLevel ? ` → L${word.prestigeLevel + 1} · +yield & bounty weight` : " · maxed"}
              </div>
            </div>
            <Button
              variant="gold"
              disabled={ascending || !canPrestige || !g.canAfford(g.price("prestige") + g.price("prestigeSnack"))}
              onClick={() => {
                const res = g.prestige(word.word);
                // A promise means it resolves later; announcing success now would celebrate a
                // gilded glow-up before the wallet prompt has even appeared. The chain store toasts
                // its own outcome, so only the synchronous (mock) result is announced here.
                if (res instanceof Promise) {
                  setAscending(true);
                  void res
                    .then((r) => {
                      // Only re-enable when NOTHING was spent. A stranded commit is paid and still
                      // open, so re-enabling would sell a second ascension on top of it.
                      if (r.status === "stranded") setStrandedNote(r.note);
                      else setAscending(false);
                    })
                    // A rejection does not say whether the fee was taken, so it must not re-enable
                    // the button — that would sell a second ascension on top of an open commit.
                    // Unknown is treated as paid, which is the safe direction.
                    .catch(() => setStrandedNote("We lost track of this ascension. Reopen to check"));
                  return;
                }
                if (res === null) return; // didn't attempt (ineligible / unaffordable — api toasted)
                g.toast(res ? "Ascended! A gilded glow-up" : "Ascension failed. No harm done", res ? "good" : "info");
              }}
            >
              {strandedNote ? "Unfinished" : ascending ? "Ascending…" : word.prestigeLevel >= maxLevel ? "Maxed" : `Ascend · ${fmtWord(g.price("prestige"))}`}
            </Button>
          </div>
          {strandedNote && <p className="mt-2 text-xs text-gold-ink">{strandedNote}</p>}
          {!word.staked && <p className="mt-2 text-xs text-candy-ink">Stake it first to ascend.</p>}
        </Card>
      )}

      {word.mine && state.chainBacked && <SellCard word={word} />}

      {/* dissolve — hidden entirely for a linked wallet's word (msg.sender-only, like the rest) */}
      <div className={`pt-1 ${word.mine ? "" : "hidden"}`}>
        {confirmDissolve ? (
          <div className="flex items-center gap-2">
            <Button full variant="danger" onClick={() => g.dissolve(word.word)}>
              Burn & recover 5 letters
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDissolve(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <button onClick={() => setConfirmDissolve(true)} className="mx-auto block text-xs font-bold text-ink/45 underline">
            dissolve this word
          </button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The word's earnings, in one tappable row: what it has earned for the player and at the latest
 * payout, or the one thing that would make it earn. Opens Your earnings.
 */
function EarningsRow({ word, h }: { word: OwnedWord; h: Hunger }) {
  const g = useGame();
  const e = g.earnings;
  const mineE = e?.byWord[word.word];
  const status = earningStatus(word, h);
  const when = e?.latestAt ? payoutWhen(e.latestAt) : null;
  return (
    <button
      onClick={() => g.openSheet({ kind: "earnings" })}
      className="cel-sm press mb-3 flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-left text-sm"
    >
      <Coins weight="fill" size={18} className="shrink-0 text-gold-ink" />
      <span className="min-w-0 flex-1">
        {/* What it earned. Hunger's effect on earning is the care note's to say (under Feed), so
            it isn't repeated here; a word that can't earn yet gets the step that would let it. */}
        {mineE && mineE.total > 0 ? (
          <span className="block">
            Earned you <strong className="font-display">{fmtWord(mineE.total)} $WORD</strong>
            {mineE.latest > 0 && when ? (
              <span className="font-bold text-gold-ink">
                {" "}
                (+{fmtWord(mineE.latest)} {when})
              </span>
            ) : null}
          </span>
        ) : (
          <span className="block">
            {status.kind === "raise" || status.kind === "unstaked"
              ? earningLine(word.word, status)
              : // null earnings are unknown (loading, or the read failed), never "earned nothing"
                e
                ? "Nothing earned yet. Its share comes with each daily payout."
                : "Adding up what it has earned…"}
          </span>
        )}
      </span>
      <CaretRight weight="bold" size={14} className="shrink-0 text-ink/45" />
    </button>
  );
}

/**
 * Sell this word on the board (decisions.md #18): a price in $WORD, a free signature, and 10% of the
 * sale goes to the Rewards Pool. A staked word can't be listed (Seaport needs the seller to hold it),
 * and a word for sale earns nothing and has no jackpot entry, so the card says so.
 */
/** The board's sale fee (params `market.wordSaleFee`, 10%), the same number the order builder uses. */
const SALE_FEE = DEFAULT_PARAMS.market.wordSaleFee;

function SellCard({ word }: { word: OwnedWord }) {
  const g = useGame();
  const { state } = g;
  const { address } = useAccount();
  const me = address?.toLowerCase();
  const listing = g.wordBoard.find((l) => l.word === word.word && l.maker === me);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const price = Number(text.replace(/[^0-9]/g, ""));
  const fee = Math.ceil(price * SALE_FEE);
  const worth = (n: number) => (showsUsd(state) ? `${fmtWord(n)} $WORD (${fmtUsd(n)})` : `${fmtWord(n)} $WORD`);

  if (listing) {
    return (
      <Card className="mb-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0">
            For sale at <strong className="font-display">{worth(listing.price)}</strong>
          </span>
          <button onClick={() => g.cancelWordListing(listing.orderHash)} className="shrink-0 text-xs font-bold text-ink/45 underline">
            Take off sale
          </button>
        </div>
        <p className="mt-1 text-xs text-ink/60">It sells the moment someone buys it. You get {fmtWord(listing.price - Math.ceil(listing.price * SALE_FEE))} $WORD.</p>
      </Card>
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
    <Card className="mb-3">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const ok = await g.listWord(word.word, price);
          setBusy(false);
          if (ok) {
            setOpen(false);
            setText("");
          }
        }}
      >
        <label className="block text-xs font-bold text-ink/60" htmlFor={`sell-${word.word}`}>
          Price, in $WORD
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`sell-${word.word}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2,000,000"
            className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-card px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-candy"
          />
          <Button size="sm" variant="teal" type="submit" disabled={busy || price <= 0}>
            List it
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink/60">
          {price > 0
            ? `The buyer pays ${worth(price)}. You get ${fmtWord(price - fee)} $WORD, and ${fmtWord(fee)} goes to the Rewards Pool.`
            : `The buyer pays your price. You get ${100 - SALE_FEE * 100}%, and ${SALE_FEE * 100}% goes to the Rewards Pool.`}{" "}
          Listing is a free signature. While it’s for sale, {word.word} earns nothing and has no jackpot entry.
        </p>
        <button type="button" onClick={() => setOpen(false)} className="mt-1 text-xs font-bold text-ink/45 underline">
          Not now
        </button>
      </form>
    </Card>
  );
}
