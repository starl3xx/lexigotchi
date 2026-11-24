"use client";
/**
 * Cheat sheet: the core loop on one screen, behind the header's "?" (and the desktop rail's link).
 *
 * starl3xx asked for "basically the onboarding flow (written for maximum understanding and minimal
 * confusion) but as a popup": collect letters; make words and raise letters; stake and feed, where
 * every staked, fed word is in the jackpot but only all-UPPERCASE ones earn $WORD. The intro tells a
 * story once; this is what a player checks mid-game. Prices are the live ones (g.price), and the
 * care thresholds come from params, so the sheet can't drift from the contracts.
 */
import type { ReactNode } from "react";
import { Button, Sheet } from "../primitives";
import { Cookie, Sparkle, TextAa } from "../ui/icons";
import { fmtUsd, fmtWord, useGame } from "../state";
import { useOnboarding } from "../Onboarding";
import { useOpenUrl } from "../useShare";
import { usePublicProfile } from "../useProfile";
import { DOCS_URL } from "@/lib/site";
import { DEFAULT_PARAMS } from "@/lib/params";

const days = (n: number) => (n === 1 ? "a day" : `${n} days`);

export function CheatSheet() {
  const g = useGame();
  const openUrl = useOpenUrl();
  const { replay } = useOnboarding();
  // Each way into the daily (and email reminders) shows only while the server has it switched on.
  const { xEnabled, emailEnabled } = usePublicProfile();
  const price = (item: Parameters<typeof g.price>[0]) => {
    const w = g.price(item);
    return `${fmtWord(w)} $WORD (${fmtUsd(w)})`;
  };
  const { peckishAfterDays, hungryAfterDays } = DEFAULT_PARAMS.care;

  return (
    <Sheet open onClose={g.closeSheet} title="Cheat sheet">
      <p className="mb-4 text-sm text-ink/60">The whole game in three steps.</p>

      <div className="space-y-3">
        <Step n={1} icon={<Sparkle weight="fill" size={18} />} title="Collect letters">
          <li>
            <strong>One free letter every day.</strong> To unlock it, tap your picture and link Farcaster
            {xEnabled ? " or X," : ""} or verify your wallet with Coinbase. Claim it each day: a day you skip
            doesn’t carry over.
          </li>
          <li>
            <strong>Or buy a pack of 5</strong> anytime: {price("pack")}.
          </li>
          <li>Every letter arrives lowercase.</li>
        </Step>

        <Step n={2} icon={<TextAa weight="bold" size={18} />} title="Make words and raise letters">
          <li>
            <strong>Spell a word:</strong> five letters of the same case that make a dictionary word.
            Claim it for {price("claim")} and it’s yours alone. Each word has one owner.
          </li>
          <li>
            <strong>Roll a letter</strong> to raise it to UPPERCASE: {price("roll")} a roll. A miss never
            hurts the letter, and every miss raises your odds on the next roll.
          </li>
          <li>Do these in any order: roll loose letters first, or roll the letters inside a word you own.</li>
        </Step>

        <Step n={3} icon={<Cookie weight="fill" size={18} />} title="Stake and feed your words">
          <li>
            <strong>Every staked word you keep fed is in the daily jackpot.</strong> Each day one secret
            word is drawn. If you hold it, staked and fed, you win the pot.
          </li>
          <li>
            <strong>Only all-UPPERCASE words earn $WORD</strong> every day, while they’re staked and fed.
          </li>
          <li>
            <strong>Feed each staked word once a day.</strong> One snack a day is free; after that, a snack
            is {price("snack")}. After {days(peckishAfterDays)} without food a word gets peckish and earns
            half. After {days(hungryAfterDays)} it’s hungry: no jackpot and no $WORD until you feed it.
          </li>
          <li>Each week, staked words that match the week’s theme also share the bounty.</li>
          {emailEnabled && (
            <li>
              <strong>Want a nudge?</strong> Add your email in your profile, and the game tells you before a
              word goes hungry.
            </li>
          )}
        </Step>
      </div>

      <Button full size="lg" variant="primary" className="mt-5" onClick={g.closeSheet}>
        Got it
      </Button>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs font-bold text-ink/55">
        <button
          onClick={() => {
            g.closeSheet();
            replay();
          }}
          className="underline"
        >
          Replay the intro
        </button>
        <span aria-hidden>·</span>
        <button onClick={() => void openUrl(`${DOCS_URL}/faq`)} className="underline">
          All questions (docs) ↗
        </button>
      </div>
    </Sheet>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="cel-sm rounded-2xl bg-card p-3.5">
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-extrabold">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-gold text-sm">
          {n}
        </span>
        <span className="text-ink/80" aria-hidden>
          {icon}
        </span>
        {title}
      </h3>
      <ul className="ml-1 list-disc space-y-1.5 pl-4 text-sm leading-snug text-ink/80 marker:text-ink/30">{children}</ul>
    </section>
  );
}
