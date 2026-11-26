"use client";
/**
 * Today: the player's dashboard, what they want to see and do every time they open the game
 * (starl3xx, 2026-11-24). In order of what they care about:
 *
 *   1. their words, each standing in its scene (TodayStage)       2. their letters (TodayLetters)
 *                                                                   3. their next steps, under the letters
 *
 * then the three pots in one row of equal tiles across both columns (starl3xx, 2026-11-26): today's
 * jackpot, the week's bounty, and the Rewards Pool, each with its $WORD amount and about what that
 * is in dollars (todayPots.ts). Then the quick actions. Desktop (lg): two columns that flow on
 * their own, the words on the left, the letters and next steps on the right. A phone stacks them
 * in the numbered order, and keeps the pots three across.
 *
 * The two are separate layouts, picked by width (useWide), not one layout reordered with CSS
 * `order`: that showed the phone one order and gave the keyboard and screen readers another (the
 * code review on #164). Each layout's DOM order is its reading order.
 *
 * The rare notices (where the player's things are, a wallet that isn't the player's, a paid pull
 * that never revealed) come first, across both columns, when there is one.
 */
import type { ReactNode } from "react";
import { Countdown, SectionTitle, TweenNumber } from "../primitives";
import { Coins, Eye, Medal, Trophy } from "../ui/icons";
import { THEMES, jackpotEligible, showsUsd, useGame } from "../state";
import { POOL_DAILY_SHARE, jackpotStanding, potLine } from "../todayPots";
import { currentWordUsd } from "@/lib/params";
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
        <NextSteps />
        <TodayPots />
        {quick}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      {alerts}
      {/* the left column: the words */}
      <div className="flex flex-col gap-4">
        <TodayStage />
      </div>
      {/* the right column: the letters, then next steps */}
      <div className="flex flex-col gap-4">
        <TodayLetters />
        <NextSteps />
      </div>
      <TodayPots />
      {quick}
    </div>
  );
}

const STANDING_TONE = { gold: "font-bold text-gold-ink", candy: "font-bold text-candy-ink", quiet: "text-ink/60" } as const;

/**
 * The three pots, three equal tiles in one row: today's jackpot, the week's bounty, and the Rewards
 * Pool. Each tile is one button into the pot's own place: the Jackpot page, its bounty half, and
 * the Earnings sheet (what the pool has paid the player's words, and how earning works).
 */
export function TodayPots() {
  const g = useGame();
  const { state } = g;
  const theme = THEMES[state.bountyTheme];
  const owns = state.words.find((w) => w.word === state.jackpotWord);
  const standing = jackpotStanding({
    revealedWord: state.jackpotRevealed ? state.jackpotWord : null,
    holds: owns ? (jackpotEligible(owns) ? "in" : "out") : null,
    wordsKnown: !state.wordsLoading && !state.wordsError,
    words: state.words.length,
    inTheRunning: state.words.filter(jackpotEligible).length,
  });
  return (
    <section aria-label="Today’s pots" className="grid grid-cols-3 gap-2 md:gap-4 lg:col-span-2">
      <PotTile label="Jackpot" word={state.jackpotPot} tone="gold" icon={<Trophy weight="fill" size={24} />} onClick={() => g.nav("jackpot")}>
        <span className="block">
          Draws in <Countdown />
        </span>
        {standing && (
          <span className={`mt-1 block ${STANDING_TONE[standing.tone]}`}>
            {standing.secret ? (
              // the eye stays with the last word, never on a line of its own
              <>
                {standing.text.slice(0, standing.text.lastIndexOf(" ") + 1)}
                <span className="whitespace-nowrap">
                  {standing.text.slice(standing.text.lastIndexOf(" ") + 1)}
                  <Eye weight="fill" size={13} className="ml-1 inline align-[-2px]" aria-hidden />
                </span>
              </>
            ) : (
              standing.text
            )}
            {standing.word && (
              <>
                {" "}
                <strong className="font-display">{standing.word}</strong>
              </>
            )}
          </span>
        )}
      </PotTile>
      <PotTile label="Bounty" word={state.bountyPool} tone="teal" icon={<Medal weight="fill" size={24} />} onClick={() => g.nav("jackpot", "bounty")}>
        <span className="block font-display text-sm font-extrabold leading-tight text-ink">{theme.name}</span>
      </PotTile>
      <PotTile label="Rewards Pool" word={state.rewardsPool} tone="teal" icon={<Coins weight="fill" size={24} />} onClick={() => g.openSheet({ kind: "earnings" })}>
        <span className="block">{POOL_DAILY_SHARE} shared every day</span>
      </PotTile>
    </section>
  );
}

const TILE_TONE = {
  gold: { tile: "from-card to-gold/15", amount: "text-gold-deep", icon: "text-gold-ink" },
  teal: { tile: "from-card to-teal/15", amount: "text-teal-ink", icon: "text-teal-ink" },
} as const;

/** One pot: its name, its $WORD amount, about what that is in dollars, and a line of its own. */
function PotTile({
  label,
  word,
  tone,
  icon,
  onClick,
  children,
}: {
  label: string;
  word: number;
  tone: keyof typeof TILE_TONE;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  const { state } = useGame();
  const o = { usd: showsUsd(state), wordUsd: currentWordUsd() };
  const known = state.potsKnown;
  const line = potLine(known ? word : null, o);
  const t = TILE_TONE[tone];
  return (
    <button
      onClick={onClick}
      className={`cel-sm press flex min-w-0 flex-col rounded-2xl bg-card bg-gradient-to-b p-3 text-left md:p-4 ${t.tile}`}
    >
      {/* A narrow tile (a phone's ~114 px, a 768 px tablet's ~149 px beside the rail): the icon
          goes above the name, so "Rewards Pool" keeps one line and the three amounts stand level.
          From lg, beside it. */}
      <span className="flex flex-col-reverse items-start gap-1 lg:flex-row lg:justify-between">
        <span className="min-w-0 text-xs font-bold leading-tight text-ink/60 md:text-sm">{label}</span>
        <span className={`press-icon shrink-0 ${t.icon}`}>{icon}</span>
      </span>
      {/* Sized to fit "776.74M" (the test game's Rewards Pool) in every tile: one size down under
          380 px (a 360 px phone's tile has 80 px), and 24 px from md, where the rail leaves a 768 px
          screen's tile 117 px inside. The full 30 px from lg. */}
      <span className={`mt-1 font-display text-lg font-extrabold leading-none min-[380px]:text-xl md:text-2xl lg:text-3xl ${t.amount}`}>
        {known ? <TweenNumber value={word} format={(v) => potLine(v, o).amount} /> : line.amount}
      </span>
      <span className="mt-1 text-xs text-ink/60">{line.unit}</span>
      {line.usd && (
        <span className="text-xs font-bold text-ink/80">
          <TweenNumber value={word} format={(v) => potLine(v, o).usd ?? ""} />
        </span>
      )}
      <span className="mt-2 block text-xs text-ink/60">{children}</span>
    </button>
  );
}
