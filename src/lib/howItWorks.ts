/**
 * The four-step "how it works" copy, shared by the first-run onboarding (`Onboarding.tsx`) and the
 * landing page (`src/app/page.tsx`), so the two can never tell a player different things.
 *
 * Every number is DERIVED (dictionary size, roll odds), never typed: the economy is tuned in
 * `params.ts`, and a hardcoded "45%" is exactly the kind of copy that goes stale the day a param
 * moves. Locale is pinned to en-US so the server render and the client render format identically.
 */
import { WORD_COUNT } from "@/lib/dictionary";
import { DEFAULT_PARAMS } from "@/lib/params";

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface HowItWorksStep {
  n: number;
  title: string;
  body: string;
}

export const HOW_IT_WORKS: readonly HowItWorksStep[] = [
  {
    n: 1,
    title: "Collect letters",
    body: "Mint one free lowercase letter every day, or grab a pack of five anytime. Every letter is a little character you own and raise.",
  },
  {
    n: 2,
    title: "Create words",
    body: `Use your letters to spell a 5-letter word from the ${WORD_COUNT.toLocaleString("en-US")}-word dictionary. Each word is a 1-of-1 and can only be held by one player at a time.`,
  },
  {
    n: 3,
    title: "Roll to upgrade",
    body: `Letters arrive lowercase. Roll to raise one to UPPERCASE: odds start at ${pct(DEFAULT_PARAMS.roll.baseSuccess)} and climb with every near-miss, and failed rolls never harm your letter. Any staked word can win the jackpot, but only UPPERCASE words earn $WORD every day.`,
  },
  {
    n: 4,
    title: "Keep them fed and win",
    body: "Stake your words and feed them daily! A fed word stays in the running; a hungry one sits it out. One word wins the jackpot every day, and a weekly themed bounty pays everyone holding a match.",
  },
];
