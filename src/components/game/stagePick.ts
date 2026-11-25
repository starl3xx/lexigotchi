/**
 * The Today stage: which word stands on it, and what it says.
 *
 * A tamagotchi's home screen is the pet, in its mood. Hunger is the reason to come back every day,
 * so the word that needs the player most takes the stage: a hungry word first (it is out of the
 * jackpot and earns nothing), then a peckish one (it earns half). With nobody hungry, the best word
 * stands there content. With nothing staked, the best unstaked word waits to be staked.
 *
 * Pure, so the rules are tested (tests/today-stage.test.ts). Only the connected wallet's words
 * (`mine`): a linked wallet's word can't be fed or staked from here.
 */
import type { Tier } from "@/lib/economy";
import type { Hunger, OwnedWord } from "./state";

export type StageMood = "hungry" | "peckish" | "full" | "unstaked" | "forSale";

export interface StagePick {
  word: OwnedWord;
  mood: StageMood;
  /** Other staked words of the player's, neediest first (the small cards under the stage). */
  others: { word: OwnedWord; mood: Exclude<StageMood, "unstaked" | "forSale"> }[];
  /** How many of the player's staked words want feeding, the star included. */
  needFood: number;
}

export const TIER_RANK: Record<Tier, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
const raised = (w: OwnedWord) => w.upper.filter(Boolean).length;

/** Best first: more letters raised, then rarer, then more gilded, then alphabetical (stable). The Showcase opens on the best word too. */
export function byBest(a: OwnedWord, b: OwnedWord): number {
  return raised(b) - raised(a) || TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.prestigeLevel - a.prestigeLevel || a.word.localeCompare(b.word);
}

const NEED: Record<Hunger, number> = { hungry: 2, peckish: 1, fed: 0 };

/**
 * `forSale`: words listed in the Market. They're never staked (Seaport needs the seller to hold
 * them), so they only matter when nothing is: a word still waiting to be staked takes the stage
 * first, and a listed one says it's for sale instead of asking to be staked.
 */
export function pickStage(words: OwnedWord[], hungerOf: (w: OwnedWord) => Hunger, forSale?: ReadonlySet<string>): StagePick | null {
  const mine = words.filter((w) => w.mine);
  const staked = mine
    .filter((w) => w.staked)
    .sort((a, b) => NEED[hungerOf(b)] - NEED[hungerOf(a)] || b.daysUnfed - a.daysUnfed || byBest(a, b));
  const moodOf = (w: OwnedWord): Exclude<StageMood, "unstaked" | "forSale"> => {
    const h = hungerOf(w);
    return h === "fed" ? "full" : h;
  };
  const needFood = staked.filter((w) => hungerOf(w) !== "fed").length;
  if (staked.length > 0) {
    const [star, ...rest] = staked;
    return { word: star, mood: moodOf(star), others: rest.map((w) => ({ word: w, mood: moodOf(w) })), needFood };
  }
  const listed = (w: OwnedWord) => forSale?.has(w.word) ?? false;
  const waiting = mine.filter((w) => !listed(w)).sort(byBest)[0];
  if (waiting) return { word: waiting, mood: "unstaked", others: [], needFood: 0 };
  const selling = mine.filter(listed).sort(byBest)[0];
  return selling ? { word: selling, mood: "forSale", others: [], needFood: 0 } : null;
}

/** One word in the stage's lineup, in the mood it shows there. */
export interface LineupItem {
  word: OwnedWord;
  mood: StageMood;
}

/**
 * Every word the player can put on the Today stage, in the order the ← and → arrows walk them:
 * the staked words neediest first (pickStage's order, so the first is the star pickStage chooses),
 * then the unstaked ones best first (they wait to be staked). Only the connected wallet's words,
 * like pickStage. `needFood` counts the staked words that want feeding ("Feed all N").
 */
export function stageLineup(
  words: OwnedWord[],
  hungerOf: (w: OwnedWord) => Hunger,
  forSale?: ReadonlySet<string>,
): { items: LineupItem[]; needFood: number } {
  const pick = pickStage(words, hungerOf, forSale);
  if (!pick) return { items: [], needFood: 0 };
  const staked: LineupItem[] = pick.mood === "unstaked" || pick.mood === "forSale" ? [] : [{ word: pick.word, mood: pick.mood }, ...pick.others];
  const unstaked = words.filter((w) => w.mine && !w.staked).sort(byBest);
  const listed = (w: OwnedWord) => forSale?.has(w.word) ?? false;
  const waiting = unstaked.filter((w) => !listed(w)).map((w): LineupItem => ({ word: w, mood: "unstaked" }));
  const selling = unstaked.filter(listed).map((w): LineupItem => ({ word: w, mood: "forSale" }));
  return { items: [...staked, ...waiting, ...selling], needFood: pick.needFood };
}

/**
 * The words that follow the featured one in the lineup, wrapping around, at most `max` of them:
 * the cards under the stage, so they show what → brings next.
 */
export function upNext<T>(items: readonly T[], index: number, max: number): T[] {
  const n = items.length;
  return Array.from({ length: Math.min(max, Math.max(0, n - 1)) }, (_, k) => items[(index + 1 + k) % n]);
}

/**
 * What the Today stage says when no word of the connected wallet can stand on it, by player:
 * - "loading": the words are still on their way (a returning player must not see the newcomer's
 *   invitation for a second).
 * - "error": the words couldn't be read; it is a connection problem, not an empty bag.
 * - "elsewhere": the player has words, all in a linked wallet (only the connected wallet's words
 *   take the stage: they can't be fed or staked from here).
 * - "spell": no words yet, and their letters spell one nobody owns.
 * - "more": no words yet, some letters, not enough to spell one.
 * - "start": brand new, no letters and no words.
 */
export type EmptyStageCase = "loading" | "error" | "elsewhere" | "spell" | "more" | "start";

export function emptyStageCase(i: { loading: boolean; error?: boolean; words: number; mineWords: number; letters: number; canSpell: boolean }): EmptyStageCase {
  if (i.loading) return "loading";
  if (i.error) return "error";
  if (i.words > 0 && i.mineWords === 0) return "elsewhere";
  if (i.canSpell) return "spell";
  return i.letters > 0 ? "more" : "start";
}

/**
 * The star's one line, in its own voice. What it needs, and what that costs it today. `earned`: what
 * it earned at the latest payout, already formatted ("40.2K", "today"), when it earned something.
 */
export function stageLine(pick: Pick<StagePick, "word" | "mood">, earned?: { amount: string; when: string }): string {
  const W = pick.word.word;
  const full5 = raised(pick.word) === pick.word.upper.length;
  switch (pick.mood) {
    case "hungry":
      return full5 ? `${W} is hungry. It can’t win or earn today.` : `${W} is hungry. It can’t win today.`;
    case "peckish":
      return full5 ? `${W} is peckish. It earns half until you feed it.` : `${W} is peckish. Feed it before it goes hungry.`;
    case "full":
      if (full5 && earned) return `${W} is full, in the jackpot, and earned ${earned.amount} $WORD ${earned.when}.`;
      return full5 ? `${W} is full, in the jackpot, and earning $WORD.` : `${W} is full and in the daily jackpot.`;
    case "unstaked":
      return `${W} is waiting. Stake it to enter the jackpot.`;
    case "forSale":
      return `${W} is for sale in the Market.`;
  }
}
