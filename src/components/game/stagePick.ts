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

export type StageMood = "hungry" | "peckish" | "full" | "unstaked";

export interface StagePick {
  word: OwnedWord;
  mood: StageMood;
  /** Other staked words of the player's, neediest first (the small cards under the stage). */
  others: { word: OwnedWord; mood: Exclude<StageMood, "unstaked"> }[];
  /** How many of the player's staked words want feeding, the star included. */
  needFood: number;
}

const TIER_RANK: Record<Tier, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
const raised = (w: OwnedWord) => w.upper.filter(Boolean).length;

/** Best first: more letters raised, then rarer, then more gilded, then alphabetical (stable). */
function byBest(a: OwnedWord, b: OwnedWord): number {
  return raised(b) - raised(a) || TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.prestigeLevel - a.prestigeLevel || a.word.localeCompare(b.word);
}

const NEED: Record<Hunger, number> = { hungry: 2, peckish: 1, fed: 0 };

export function pickStage(words: OwnedWord[], hungerOf: (w: OwnedWord) => Hunger): StagePick | null {
  const mine = words.filter((w) => w.mine);
  const staked = mine
    .filter((w) => w.staked)
    .sort((a, b) => NEED[hungerOf(b)] - NEED[hungerOf(a)] || b.daysUnfed - a.daysUnfed || byBest(a, b));
  const moodOf = (w: OwnedWord): Exclude<StageMood, "unstaked"> => {
    const h = hungerOf(w);
    return h === "fed" ? "full" : h;
  };
  const needFood = staked.filter((w) => hungerOf(w) !== "fed").length;
  if (staked.length > 0) {
    const [star, ...rest] = staked;
    return { word: star, mood: moodOf(star), others: rest.map((w) => ({ word: w, mood: moodOf(w) })), needFood };
  }
  const best = [...mine].sort(byBest)[0];
  return best ? { word: best, mood: "unstaked", others: [], needFood: 0 } : null;
}

/** The star's one line, in its own voice. What it needs, and what that costs it today. */
export function stageLine(pick: Pick<StagePick, "word" | "mood">): string {
  const W = pick.word.word;
  const full5 = raised(pick.word) === pick.word.upper.length;
  switch (pick.mood) {
    case "hungry":
      return full5 ? `${W} is hungry. It can’t win or earn today.` : `${W} is hungry. It can’t win today.`;
    case "peckish":
      return full5 ? `${W} is peckish. It earns half until you feed it.` : `${W} is peckish. Feed it before it goes hungry.`;
    case "full":
      return full5 ? `${W} is full, in the jackpot, and earning $WORD.` : `${W} is full and in the daily jackpot.`;
    case "unstaked":
      return `${W} is waiting. Stake it to enter the jackpot.`;
  }
}
