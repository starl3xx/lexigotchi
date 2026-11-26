"use client";
/**
 * Mint — pull lowercase letters: the free letters for verified players (a pack of 5 plus 10 daily
 * letters, decisions.md #21) and paid packs of 5. Odds mirror the dictionary.
 */
import { LETTERS_BY_FREQUENCY, TOTAL_SLOTS } from "@/lib/economy";
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { Check, Diamond, Package, Ticket } from "../ui/icons";
import { fmtUsd, fmtWord, idxToChar, showsUsd, useGame } from "../state";
import { DailyUnlock, useDailyEligibility } from "../DailyUnlock";
import { useState } from "react";
import { PendingReveal } from "../PendingReveal";

export function MintScreen() {
  const g = useGame();
  const { state } = g;
  const daily = useDailyEligibility();
  // The player's free letters (daily-status): how many daily letters are left, whether the pack is
  // taken, and whether free letters have stopped. Null in practice and while it loads.
  const free = g.freeLetters;
  /** A paid chain pack is in flight (commit sent or about to be): hold the button. */
  const [buying, setBuying] = useState(false);
  const packPrice = g.price("pack");
  // Every letter in the game is minted or promised to an open pack: the contract would refuse.
  const soldOut = g.lettersLeft !== null && g.lettersLeft < 5;
  const common = LETTERS_BY_FREQUENCY.slice(0, 5);
  const rare = LETTERS_BY_FREQUENCY.slice(-5);

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="lg:col-span-2">
        <h1 className="font-display text-2xl font-extrabold md:hidden">Mint letters</h1>
        <p className="text-sm text-ink/60">
          Every pull is <strong>lowercase</strong>. Capitals are <em>raised</em> in the Roll, never pulled.
        </p>
      </div>

      {/* a paid pull whose reveal never landed — recover it before offering anything new */}
      <div className="empty:hidden lg:col-span-2">
        <PendingReveal />
      </div>

      {/* daily single */}
      <Card className="bg-card">
        <SectionTitle
          action={
            <span className="text-xs font-bold text-teal-ink">
              {!daily.eligible ? "Free" : free?.dailyLeft != null ? `Free · ${free.dailyLeft} of ${free.dailyLimit} left` : "Free · 1 a day"}
            </span>
          }
        >
          {daily.eligible ? "Daily letter" : "Free letters"}
        </SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm text-ink/70">
            <span className="inline-flex items-center gap-1">
              {state.dailyLetter != null && (
                <span className="mr-1.5">
                  <LetterTile char={idxToChar(state.dailyLetter)} size={30} title={`Today’s letter: ${idxToChar(state.dailyLetter).toLowerCase()}`} />
                </span>
              )}
              Pulled today <Check weight="bold" size={13} className="text-teal-ink" />
            </span>
            {/* the 10th was the last: no countdown to a letter that isn't coming */}
            {free?.done ? (
              <span className="text-xs text-ink/50">your last free one</span>
            ) : (
              <span className="text-xs text-ink/50">resets in <Countdown /></span>
            )}
          </div>
        ) : daily.eligible && free && (free.done || free.stop) ? (
          <p className="text-sm text-ink/70">
            {free.done
              ? `You’ve had all ${free.dailyLimit} free daily letters. Packs of 5 are always for sale below.`
              : free.stop === "dictionary"
                ? "The dictionary is nearly full, so free letters have ended. Packs are still for sale."
                : "All the free letters have been given out. Packs are still for sale."}
          </p>
        ) : !daily.eligible ? (
          // Locked. Farcaster, an old-enough X account (while X is on), or a Coinbase-verified wallet
          // opens it, and the shared DailyUnlock is the one place that offers them, so Home and Mint
          // can't drift.
          <DailyUnlock />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/70">One free letter a day, on the house, until you’ve had {free?.dailyLimit ?? 10}.</span>
            <Button onClick={() => g.dailyMint()}>
              <Ticket weight="fill" /> Pull free
            </Button>
          </div>
        )}
      </Card>

      {/* the free pack: once per verified profile (decisions.md #21). Locked players see the offer in
          DailyUnlock, in the daily card above. */}
      {state.chainBacked && daily.eligible && free && !free.packTaken && !free.packStop && (
        <Card className="bg-card">
          <SectionTitle action={<span className="text-xs font-bold text-teal-ink">Free · once</span>}>Your free pack</SectionTitle>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/70">Five letters, on the house, for proving you’re one person.</span>
            <Button onClick={() => g.openPack()}>
              <Ticket weight="fill" /> Open free
            </Button>
          </div>
        </Card>
      )}

      {/* pack of 5: paid, for every wallet */}
      <Card className="bg-gradient-to-b from-card to-candy/10">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-xl font-extrabold">Pack of 5</div>
            <div className="text-xs text-ink/60">{showsUsd(state) ? `${fmtWord(packPrice)} $WORD · ${fmtUsd(packPrice)}` : `${fmtWord(packPrice)} $WORD`}</div>
          </div>
          <Package weight="fill" size={40} className="text-candy-ink" />
        </div>
        <Button
          full
          size="lg"
          variant="primary"
          className="mt-3"
          disabled={buying || soldOut}
          onClick={() => {
            // broke ≠ blocked: route the intent to the Buy sheet with the exact shortfall.
            if (!g.canAfford(packPrice)) {
              g.openSheet({ kind: "balance", need: { amount: packPrice, action: "a pack" } });
              return;
            }
            const result = g.buyPack();
            if (Array.isArray(result)) {
              if (result.length) g.openSheet({ kind: "pack", letters: result });
              return;
            }
            // Chain store: two wallet prompts, then the reveal opens the pack sheet itself. Hold the
            // button the whole time so a second tap can't buy a second pack by accident; a pack that
            // ends "stranded" is paid for and waits in PendingReveal above.
            setBuying(true);
            void result
              .then((outcome) => {
                if (outcome.status === "stranded") g.toast(outcome.note, "info");
              })
              .finally(() => setBuying(false));
          }}
        >
          <Package weight="fill" />
          {soldOut ? "Sold out" : buying ? "Opening…" : g.canAfford(packPrice) ? "Rip a pack open" : "Get $WORD to rip a pack"}
        </Button>
        {free?.dictionaryFull && (
          // About 95% of the words have owners (decisions.md #21): letters still sell, but a new word is
          // more likely to come from the Market than from a pack.
          <p className="mt-2 text-center text-xs text-ink/60">
            The dictionary is nearly full: most words already have an owner. Packs still sell, and the Market has words and
            letters for sale.{" "}
            <button onClick={() => g.nav("swap")} className="font-bold text-teal-ink underline">
              See the Market
            </button>
          </p>
        )}
      </Card>

      {/* odds preview */}
      <Card>
        <SectionTitle>The odds mirror the dictionary</SectionTitle>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-bold text-ink/60">Most common</div>
            <div className="flex gap-2">
              {common.map((L) => <LetterTile key={L} char={L} size={38} />)}
            </div>
          </div>
          <div>
            <div className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-ink/60">
              Grails <Diamond weight="fill" size={11} className="text-gold-ink" />
            </div>
            <div className="flex gap-2">
              {rare.map((L) => <LetterTile key={L} char={L} size={38} />)}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/55">
          A letter’s pull rate = its share of the {TOTAL_SLOTS.toLocaleString("en-US")} dictionary slots. Q is the Charizard.
        </p>
      </Card>
    </div>
  );
}
