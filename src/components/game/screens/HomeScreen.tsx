"use client";
/**
 * Today: the player's dashboard, what they want to see and do every time they open the game
 * (starl3xx, 2026-11-24). In order of what they care about:
 *
 *   1. their words, each standing in its scene (TodayStage)       2. their letters (TodayLetters)
 *   3. today's jackpot, under the words                             4. their next steps, under the letters
 *
 * then the week's bounty and the quick actions. Desktop (lg): two columns that flow on their own,
 * words and jackpot on the left, letters, next steps, and bounty on the right, so a tall stage
 * never leaves a gap under the letters. A phone stacks them in the numbered order.
 *
 * The two are separate layouts, picked by width (useWide), not one layout reordered with CSS
 * `order`: that showed the phone one order and gave the keyboard and screen readers another (the
 * code review on #164). Each layout's DOM order is its reading order.
 *
 * The rare notices (where the player's things are, a wallet that isn't the player's, a paid pull
 * that never revealed) come first, across both columns, when there is one.
 */
import { Button, Card, Countdown, SectionTitle, TweenNumber } from "../primitives";
import { Eye, Medal, Trophy } from "../ui/icons";
import { THEMES, fmtWord, jackpotEligible, useGame } from "../state";
import { QuickGrid } from "../QuickGrid";
import { PendingReveal } from "../PendingReveal";
import { WalletMismatch } from "../WalletMismatch";
import { NextSteps } from "../NextSteps";
import { TodayStage } from "../TodayStage";
import { TodayLetters } from "../TodayLetters";
import { GameWalletNotice } from "../GameWalletNotice";
import { useWide } from "../useWide";

export function HomeScreen() {
  const wide = useWide();
  const alerts = (
    <>
      {/* Where the player's things are, when it matters (GameWalletNotice). */}
      <div className="empty:hidden lg:col-span-2">
        <GameWalletNotice />
      </div>
      {/* connected wallet isn't one of the FID's linked wallets: the bag is about to fork */}
      <div className="empty:hidden lg:col-span-2">
        <WalletMismatch />
      </div>
      {/* a paid pull whose reveal never landed: recover it before offering anything new */}
      <div className="empty:hidden lg:col-span-2">
        <PendingReveal />
      </div>
    </>
  );
  const quick = (
    <div className="lg:col-span-2">
      <SectionTitle>Do something</SectionTitle>
      <QuickGrid />
    </div>
  );

  if (!wide) {
    return (
      <div className="flex flex-col gap-3">
        {alerts}
        <TodayStage />
        <TodayLetters />
        <JackpotCard />
        <NextSteps />
        <BountyTeaser />
        {quick}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      {alerts}
      {/* the left column: the words, then the jackpot */}
      <div className="flex flex-col gap-4">
        <TodayStage />
        <JackpotCard />
      </div>
      {/* the right column: the letters, then next steps, then the bounty */}
      <div className="flex flex-col gap-4">
        <TodayLetters />
        <NextSteps />
        <BountyTeaser />
      </div>
      {quick}
    </div>
  );
}

/** Today's jackpot: the pot, the draw, and whether the player may hold the secret word. */
function JackpotCard() {
  const g = useGame();
  const { state } = g;
  const ownsAnswer = state.words.find((w) => w.word === state.jackpotWord);
  return (
    <Card className="bg-gradient-to-b from-card to-gold/15">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-bold text-ink/60">Today’s jackpot</div>
          <div className="font-display text-3xl font-extrabold text-gold-deep">
            <TweenNumber value={state.jackpotPot} format={fmtWord} />
          </div>
          <div className="text-xs text-ink/60">
            $WORD · draws in <Countdown />
          </div>
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
        ) : state.wordsLoading || state.wordsError ? (
          // Not known yet: a returning player must never read the newcomer's line while loading.
          <span className="text-ink/60">The secret word is hidden until the draw.</span>
        ) : state.words.length === 0 ? (
          // A player with nothing in the draw hears how to get in, not just that the word is secret.
          <span className="text-ink/60">Spell a word and stake it to be in the draw.</span>
        ) : !state.words.some(jackpotEligible) ? (
          <span className="text-ink/60">None of your words is in the draw. Stake one and keep it fed.</span>
        ) : (
          <span className="text-ink/60">The secret word is hidden until the draw.</span>
        )}
      </div>
      <Button full variant="gold" className="mt-3" onClick={() => g.nav("jackpot")}>
        Open the jackpot
      </Button>
    </Card>
  );
}

/** This week's bounty theme, a tap away. */
function BountyTeaser() {
  const g = useGame();
  const theme = THEMES[g.state.bountyTheme];
  return (
    <button onClick={() => g.nav("bounty")} className="w-full text-left">
      <Card className="press bg-teal/10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-teal-ink">This week’s bounty</div>
            <div className="font-display font-extrabold">{theme.name}</div>
            <div className="text-xs text-ink/60">Hold matching words, staked &amp; fed, to share the pool.</div>
          </div>
          <Medal weight="fill" size={30} className="shrink-0 text-teal-ink" />
        </div>
      </Card>
    </button>
  );
}
