/**
 * The four-step "how it works" copy, shared by the first-run onboarding (`Onboarding.tsx`) and the
 * landing page (`src/app/page.tsx`), so the two can never tell a player different things. The steps
 * follow the premise in the messaging guide (docs/messaging.md, decisions.md #22): collect letters,
 * raise them, spell words only you can own, and keep them fed.
 *
 * Every number is DERIVED (dictionary size, roll odds, tier counts, supply, free letters), never
 * typed: the economy is tuned in `params.ts` and `economy.ts`, and a hardcoded "45%" is exactly the
 * kind of copy that goes stale the day a param moves. Locale is pinned to en-US so the server render
 * and the client render format identically.
 */
import { HOLOGRAPHIC_LEVEL, stageName } from "@/lib/ascension";
import { WORD_COUNT } from "@/lib/dictionary";
import { LETTERS_BY_FREQUENCY, LETTER_SUPPLY_CAP, TIERS, TIER_COUNTS } from "@/lib/economy";
import { FREE_LETTERS } from "@/lib/freeLetters";
import { DEFAULT_PARAMS } from "@/lib/params";

export const pct = (x: number) => `${Math.round(x * 100)}%`;
/** A USD target from params, as the player reads it ($0.50). The live $WORD amount moves with the price. */
export const usd = (x: number) => `$${x.toFixed(2)}`;
/** A count as players read it: 4,584. */
export const count = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// The facts the copy quotes, derived
// ---------------------------------------------------------------------------

/** The dictionary's size, formatted: "4,584". */
export const WORDS = count(WORD_COUNT);

const TOP = TIERS[TIERS.length - 1].name;
/**
 * The rarest rarity tier: its name and how many words are in it. The name comes from `TIERS`, so it
 * reads "Legendary" until the rarity rename (Legendary → Mythic, docs/messaging.md's TODO) lands,
 * and follows it on its own after.
 */
export const TOP_TIER = { name: TOP, count: TIER_COUNTS[TOP] } as const;

const RAREST = LETTERS_BY_FREQUENCY[LETTERS_BY_FREQUENCY.length - 1];
/**
 * The rarest letter, lowercase as every letter arrives ("q"), and how many will ever exist: its
 * supply cap at the launch multiple (economy.ts `DEMAND_MULTIPLE`).
 */
export const RAREST_LETTER = { char: RAREST.toLowerCase(), supply: LETTER_SUPPLY_CAP[RAREST] } as const;

/** The free pack's letters and the free daily letters, per verified player (decisions.md #21). */
export const FREE_PACK = FREE_LETTERS.pack;
export const FREE_DAILIES = DEFAULT_PARAMS.freeLetters.freeDailyLimit * FREE_LETTERS.daily;
/** Free letters to start: the pack plus every free daily letter. */
export const FREE_TO_START = FREE_PACK + FREE_DAILIES;

/** The ascension ladder above UPPERCASE: "Gilded 1 through 4, then Holographic". */
export const LADDER = `${stageName(1)} through ${HOLOGRAPHIC_LEVEL - 1}, then ${stageName(HOLOGRAPHIC_LEVEL)}`;

/** "a day" or "3 days", for the care rules. */
export const days = (n: number) => (n === 1 ? "a day" : `${n} days`);

// ---------------------------------------------------------------------------
// The four steps
// ---------------------------------------------------------------------------

export interface HowItWorksStep {
  n: number;
  /** Which step this is, so each screen pairs its own picture with it whatever the order. */
  id: "collect" | "raise" | "spell" | "feed";
  title: string;
  body: string;
}

export const HOW_IT_WORKS: readonly HowItWorksStep[] = [
  {
    n: 1,
    id: "collect",
    title: "Collect letters",
    body: `Free to start: prove you’re one person for a pack of ${FREE_PACK} plus ${FREE_DAILIES} free daily letters, or grab a pack anytime. Every letter is a little character that’s yours to raise.`,
  },
  {
    n: 2,
    id: "raise",
    title: "Raise them",
    body: `Every letter starts lowercase. Roll one to raise it to UPPERCASE: odds start at ${pct(DEFAULT_PARAMS.roll.baseSuccess)} and climb with every miss, and a miss never hurts it.`,
  },
  {
    n: 3,
    id: "spell",
    title: "Spell words",
    body: `Five letters make a word from the ${WORDS}-word dictionary, and that word is yours alone: every word has one owner. Claiming one costs about ${usd(DEFAULT_PARAMS.prices.claim)} in $WORD.`,
  },
  {
    n: 4,
    id: "feed",
    title: "Keep them fed",
    body: "Stake your words and feed them every day. A fed word is in the running for the daily jackpot, and an all-UPPERCASE one earns $WORD every day. A hungry word sits it out until you feed it.",
  },
];
