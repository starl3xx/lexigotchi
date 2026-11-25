/**
 * The Bag's filters and sorts (starl3xx: "Bag should also have sort/filter ability for words and
 * maybe letters"). Pure, so every rule is tested (tests/bag-view.test.ts).
 */
import { byBest, TIER_RANK } from "./stagePick";
import { wordCase, type Hunger, type OwnedWord } from "./state";

export type WordFilter = "all" | "staked" | "unstaked" | "earning" | "needsFood" | "forSale";
// No "rarest" any more: Best first leads with rarity, so it sorted the same (a stored "rarest" reads as
// the default through validChoice).
export type WordSort = "best" | "hungriest" | "az";
export type LetterSort = "az" | "most";

export const WORD_FILTERS: readonly WordFilter[] = ["all", "staked", "unstaked", "earning", "needsFood", "forSale"];
export const WORD_SORTS: readonly WordSort[] = ["best", "hungriest", "az"];
export const LETTER_SORTS: readonly LetterSort[] = ["az", "most"];

export const WORD_FILTER_LABEL: Record<WordFilter, string> = {
  all: "All",
  staked: "Staked",
  unstaked: "Not staked",
  earning: "Earning",
  needsFood: "Needs food",
  forSale: "For sale",
};
export const WORD_SORT_LABEL: Record<WordSort, string> = {
  best: "Best first",
  hungriest: "Hungriest first",
  az: "A to Z",
};

interface Ctx {
  hungerOf: (w: OwnedWord) => Hunger;
  forSale: ReadonlySet<string>;
}

/** Does `w` belong under filter `f`? "Not staked" leaves out listed words: they have their own chip. */
export function matchesWord(w: OwnedWord, f: WordFilter, { hungerOf, forSale }: Ctx): boolean {
  switch (f) {
    case "all":
      return true;
    case "staked":
      return w.staked;
    case "unstaked":
      return !w.staked && !forSale.has(w.word);
    case "earning":
      return w.staked && wordCase(w) === "UPPERCASE" && hungerOf(w) !== "hungry";
    case "needsFood":
      return w.staked && hungerOf(w) !== "fed";
    case "forSale":
      return forSale.has(w.word);
  }
}

/** How many words each filter would show, for the chip labels (a chip with none is hidden). */
export function wordFilterCounts(words: readonly OwnedWord[], ctx: Ctx): Record<WordFilter, number> {
  return Object.fromEntries(WORD_FILTERS.map((f) => [f, words.filter((w) => matchesWord(w, f, ctx)).length])) as Record<WordFilter, number>;
}

const NEED: Record<Hunger, number> = { hungry: 2, peckish: 1, fed: 0 };

export function sortWords(words: readonly OwnedWord[], s: WordSort, hungerOf: (w: OwnedWord) => Hunger): OwnedWord[] {
  const out = [...words];
  switch (s) {
    case "best":
      return out.sort(byBest);
    case "hungriest":
      // Staked words first (only they go hungry), neediest and longest unfed first.
      return out.sort(
        (a, b) =>
          Number(b.staked) - Number(a.staked) ||
          (b.staked ? NEED[hungerOf(b)] : 0) - (a.staked ? NEED[hungerOf(a)] : 0) ||
          b.daysUnfed - a.daysUnfed ||
          byBest(a, b),
      );
    case "az":
      return out.sort((a, b) => a.word.localeCompare(b.word));
  }
}

/** Loose letters by letter (A to Z) or by how many the bag holds (most first, then A to Z). */
export function sortLetters<T extends { i: number; c: number }>(xs: readonly T[], s: LetterSort): T[] {
  return [...xs].sort((a, b) => (s === "most" ? b.c - a.c : 0) || a.i - b.i);
}

/** A stored choice is used only if it's still one of the allowed values. */
export function validChoice<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}
