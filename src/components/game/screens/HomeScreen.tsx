"use client";
/** Today — the daily hub: care alert, daily letter, jackpot teaser, bounty, quick actions. */
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { ReminderToggle } from "../ReminderToggle";
import {
  ArrowsLeftRight,
  Backpack,
  BookOpen,
  Check,
  Cookie,
  Eye,
  Fire,
  MaskHappy,
  Medal,
  Smiley,
  Sparkle,
  TextAa,
  Ticket,
  Trophy,
} from "../ui/icons";
import { COST, THEMES, fmtWord, hunger, jackpotEligible, useGame, type View } from "../state";
import { DailyUnlock, useDailyEligibility } from "../DailyUnlock";
import { QuickGrid } from "../QuickGrid";
import { PendingReveal } from "../PendingReveal";
import { WalletMismatch } from "../WalletMismatch";
import { NextSteps } from "../NextSteps";

export function HomeScreen() {
  const g = useGame();
  const { state } = g;
  const daily = useDailyEligibility();
  const needFood = state.words.filter((w) => w.staked && hunger(w) !== "fed");
  const ownsAnswer = state.words.find((w) => w.word === state.jackpotWord);
  const theme = THEMES[state.bountyTheme];

  return (
    // Desktop (lg): a two-column dashboard; banners and the quick grid span both columns.
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      {/* What this player can do right now, each with its button (todaySteps.ts). */}
      <div className="empty:hidden lg:col-span-2">
        <NextSteps />
      </div>

      {/* hero — daily jackpot */}
      <Card className="bg-gradient-to-b from-paper to-gold/15">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink/60">Today’s jackpot</div>
            <div className="font-display text-3xl font-extrabold text-gold-deep">{fmtWord(state.jackpotPot)}</div>
            <div className="text-xs text-ink/60">$WORD · draws in <Countdown /></div>
          </div>
          <Trophy weight="fill" size={40} className="text-gold-ink" />
        </div>
        <div className="mt-3 rounded-xl border-2 border-dashed border-ink/30 p-2 text-center text-sm">
          {state.jackpotRevealed ? (
            <span>
              Today’s word was <strong className="font-display">{state.jackpotWord}</strong>
            </span>
          ) : ownsAnswer && jackpotEligible(ownsAnswer) ? (
            <span className="inline-flex items-center gap-1 font-bold text-candy-ink">
              You may be holding today’s secret word <Eye weight="fill" size={14} />
            </span>
          ) : ownsAnswer ? (
            <span className="font-bold text-candy-ink">You hold today’s word. Stake and feed it to be in the draw!</span>
          ) : (
            <span className="text-ink/60">The secret word is hidden until the draw.</span>
          )}
        </div>
        <Button full variant="gold" className="mt-3" onClick={() => g.nav("jackpot")}>
          Open the jackpot
        </Button>
      </Card>

      {/* care alert */}
      {needFood.length > 0 ? (
        <Card className="bg-candy/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-extrabold">
                {needFood.length} {needFood.length === 1 ? "word needs" : "words need"} feeding
              </div>
              <div className="text-xs text-ink/60">
                Peckish UPPERCASE words earn half. Hungry words (3+ days) earn nothing and can’t win the jackpot.
              </div>
              <ReminderToggle compact />
            </div>
            <Button variant="teal" className="shrink-0 whitespace-nowrap" onClick={g.feedAll}>
              <Cookie weight="fill" /> Feed all
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex items-center justify-between bg-teal/10">
          <div className="font-display font-bold">Your collection is fed</div>
          <Smiley weight="fill" size={26} className="text-teal-ink" />
        </Card>
      )}

      {/* connected wallet isn't one of the FID's linked wallets — the bag is about to fork */}
      <div className="empty:hidden lg:col-span-2">
        <WalletMismatch />
      </div>

      {/* a paid pull whose reveal never landed — recover it before offering anything new */}
      <div className="empty:hidden lg:col-span-2">
        <PendingReveal />
      </div>

      {/* daily letter */}
      <Card>
        <SectionTitle>Daily letter</SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1 text-ink/70">
              Claimed today <Check weight="bold" size={13} className="text-teal-ink" />
              {/* streak is a mock-only stat — on chain it would always read 0, which looks broken */}
              {!state.chainBacked && (
                <>
                  {" "}· streak <Fire weight="fill" size={13} className="text-candy-ink" /> {state.streak}
                </>
              )}
            </span>
            <span className="text-xs text-ink/50">resets in <Countdown /></span>
          </div>
        ) : !daily.eligible ? (
          // Locked — a signed-out web player can't claim it (and bump their streak) from here.
          // The shared DailyUnlock offers both identities: Farcaster, or a Coinbase-verified
          // wallet. Inside a Farcaster client the viewer is auto-authed, so this never shows.
          <DailyUnlock />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink/70">
              One free pull a day keeps the streak alive.
              <div className="text-xs text-ink/50">Free · on the house</div>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                const idx = g.dailyMint();
                // "pending" = the on-chain flow started; only a real null means "already pulled".
                // Conflating them told a first-time player they had already claimed.
                if (idx === null) g.toast("Already claimed today", "info");
              }}
            >
              <Ticket weight="fill" /> Pull
            </Button>
          </div>
        )}
      </Card>

      {/* bounty teaser */}
      <button onClick={() => g.nav("bounty")} className="w-full text-left">
        <Card className="bg-teal/10 transition-[transform,box-shadow] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-teal-ink">This week’s bounty</div>
              <div className="font-display font-extrabold">{theme.name}</div>
              <div className="text-xs text-ink/60">Hold matching words, staked &amp; fed, to share the pool.</div>
            </div>
            <Medal weight="fill" size={30} className="shrink-0 text-teal-ink" />
          </div>
        </Card>
      </button>

      {/* quick actions */}
      <div className="lg:col-span-2">
        <SectionTitle>Do something</SectionTitle>
        <QuickGrid />
      </div>
    </div>
  );
}

