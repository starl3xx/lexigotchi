"use client";
/**
 * Cheat sheet: the core loop on one screen, behind the header's "?" (and the desktop rail's link).
 *
 * starl3xx asked for "basically the onboarding flow (written for maximum understanding and minimal
 * confusion) but as a popup". It follows the premise in the messaging guide (docs/messaging.md,
 * decisions.md #23): collect letters, raise them, spell words only you can own, and keep them fed,
 * where every staked, fed word is in the running for the jackpot but only all-UPPERCASE ones earn
 * $WORD. The intro tells a story once; this is what a player checks mid-game. Prices are the live
 * ones (g.price), and the care thresholds and free letters come from params, so the sheet can't
 * drift from the contracts.
 */
import type { ReactNode } from "react";
import { Button, Sheet } from "../primitives";
import { Cookie, DiceFive, Sparkle, TextAa } from "../ui/icons";
import { fmtUsd, fmtWord, showsUsd, useGame } from "../state";
import { useOnboarding } from "../Onboarding";
import { useOpenUrl } from "../useShare";
import { usePublicProfile } from "../useProfile";
import { DOCS_URL } from "@/lib/site";
import { DEFAULT_PARAMS } from "@/lib/params";
import { FREE_DAILIES, FREE_PACK, days } from "@/lib/howItWorks";

export function CheatSheet() {
  const g = useGame();
  const openUrl = useOpenUrl();
  const { replay } = useOnboarding();
  // Each way into the daily (and email reminders) shows only while the server has it switched on.
  const { xEnabled, emailEnabled, profilesEnabled } = usePublicProfile();
  const price = (item: Parameters<typeof g.price>[0]) => {
    const w = g.price(item);
    return showsUsd(g.state) ? `${fmtWord(w)} $WORD (${fmtUsd(w)})` : `${fmtWord(w)} $WORD`;
  };
  const { peckishAfterDays, hungryAfterDays } = DEFAULT_PARAMS.care;

  return (
    <Sheet open onClose={g.closeSheet} title="Cheat sheet">
      <p className="mb-4 text-sm text-ink/60">
        The whole game in four steps: collect letters, raise them, spell words only you can own, and keep them fed.
      </p>

      <div className="space-y-3">
        <Step n={1} icon={<Sparkle weight="fill" size={18} />} title="Collect letters">
          <li>
            <strong>
              Free to start: a pack of {FREE_PACK} plus {FREE_DAILIES} free daily letters.
            </strong>{" "}
            To unlock them, tap your picture and link Farcaster{xEnabled ? " or X," : ""} or verify your wallet with
            Coinbase. Take one daily letter a day until you’ve had {FREE_DAILIES}.
          </li>
          <li>
            <strong>Or buy a pack of {FREE_PACK}</strong> anytime: {price("pack")}.
          </li>
          <li>Every letter is a little character, and every one arrives lowercase.</li>
          {profilesEnabled && (
            <li>
              <strong>Play with more than one wallet?</strong> Link them in your profile: one bag and one set of
              free letters between them. Your letters live onchain in each wallet, so choose one game wallet and
              keep everything there.
            </li>
          )}
        </Step>

        <Step n={2} icon={<DiceFive weight="fill" size={18} />} title="Raise them">
          <li>
            <strong>Roll a letter</strong> to raise it to UPPERCASE: {price("roll")} a roll. A miss never
            hurts the letter, and every miss raises your odds on the next roll.
          </li>
          <li>Roll loose letters, or the letters inside a word you own: whichever you like first.</li>
        </Step>

        <Step n={3} icon={<TextAa weight="bold" size={18} />} title="Spell words">
          <li>
            <strong>Five letters make a word:</strong> any five that spell a dictionary word, in any mix of
            lowercase and UPPERCASE. Claim it for {price("claim")} and it’s yours alone. Each word has one owner.
          </li>
        </Step>

        <Step n={4} icon={<Cookie weight="fill" size={18} />} title="Keep them fed">
          <li>
            <strong>Stake your words and feed each one once a day.</strong> One snack a day is free for your
            whole profile; after that, a snack is {price("snack")}. After {days(peckishAfterDays)} without food a
            word gets peckish and earns half. After {days(hungryAfterDays)} it’s hungry: it sits out the jackpot
            and earns no $WORD until you feed it.
          </li>
          <li>
            <strong>Every word you keep staked and fed is in the running for the daily jackpot.</strong> Each day
            one secret word is drawn. If you hold it, staked and fed, the pot is yours.
          </li>
          <li>
            <strong>All-UPPERCASE words earn $WORD</strong> every day, while they’re staked and fed. It’s paid
            each day, straight to the wallet that holds the word: nothing to claim. Tap the line under your words
            on Today to see what each one has earned.
          </li>
          <li>Each week, staked words that match the week’s theme also share the bounty.</li>
          <li>
            <strong>Sell a word</strong> from its card, for $WORD you choose. You get 90%; 10% goes to the
            Rewards Pool. The form shows about what the word costs to make.
          </li>
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
