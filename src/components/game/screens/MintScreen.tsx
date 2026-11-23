"use client";
/** Mint — pull lowercase letters. Daily single (FID-gated) + packs of 5. Odds mirror the dictionary. */
import { LETTERS_BY_FREQUENCY, TOTAL_SLOTS } from "@/lib/economy";
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { Check, Diamond, Package, Ticket } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";
import { DailyUnlock, useDailyEligibility } from "../DailyUnlock";
import { useEffect, useState } from "react";
import { fetchCampaignStatus } from "../campaignClient";
import { useViewer } from "../useViewer";
import { PendingReveal } from "../PendingReveal";

export function MintScreen() {
  const g = useGame();
  const { state } = g;
  const daily = useDailyEligibility();
  const viewer = useViewer();
  // The FREE campaign pack is gated server-side on add+share. Ask up front so only an eligible
  // player sees its button, instead of one that bounces off a 403 ("rip a pack does nothing" was
  // the live report). null = unknown (not signed in / DB absent) → no free-pack card.
  const [packEligible, setPackEligible] = useState<boolean | null>(null);
  /** A paid chain pack is in flight (commit sent or about to be): hold the button. */
  const [buying, setBuying] = useState(false);
  useEffect(() => {
    if (!state.chainBacked || !viewer.isAuthed) return void setPackEligible(null);
    let dead = false;
    void fetchCampaignStatus().then((cs) => { if (!dead) setPackEligible(cs ? cs.eligible : null); });
    return () => { dead = true; };
  }, [state.chainBacked, viewer.isAuthed]);
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
      <Card className="bg-paper">
        <SectionTitle action={<span className="text-xs font-bold text-teal-ink">Free · 1 / day</span>}>Daily single</SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm text-ink/70">
            <span className="inline-flex items-center gap-1">
              Pulled today <Check weight="bold" size={13} className="text-teal-ink" />
            </span>
            <span className="text-xs text-ink/50">resets in <Countdown /></span>
          </div>
        ) : !daily.eligible ? (
          // Locked. Two identities open it — Farcaster, or a Coinbase-verified wallet — and the
          // shared DailyUnlock is the one place that offers both, so Home and Mint can't drift.
          <DailyUnlock />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/70">One free letter, on the house, every day.</span>
            <Button onClick={() => g.dailyMint()}>
              <Ticket weight="fill" /> Pull free
            </Button>
          </div>
        )}
      </Card>

      {/* the free campaign pack: only for players who earned it (add the mini app + share a cast) */}
      {state.chainBacked && packEligible === true && (
        <Card className="bg-paper">
          <SectionTitle action={<span className="text-xs font-bold text-teal-ink">Free · once</span>}>Your free pack</SectionTitle>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink/70">Five letters, on the house, for sharing Lexigotchi.</span>
            <Button onClick={() => g.openPack()}>
              <Ticket weight="fill" /> Open free
            </Button>
          </div>
        </Card>
      )}

      {/* pack of 5: paid, for every wallet */}
      <Card className="bg-gradient-to-b from-paper to-candy/10">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-xl font-extrabold">Pack of 5</div>
            <div className="text-xs text-ink/60">{`${fmtWord(packPrice)} $WORD · ${fmtUsd(packPrice)}`}</div>
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
        {state.chainBacked && packEligible === false && (
          <p className="mt-2 text-center text-xs text-ink/55">
            Earn a free pack: add Lexigotchi in the Farcaster app and share a cast.
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
