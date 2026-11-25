/**
 * What a word costs to make, and what it earns: the reference numbers beside a word for sale
 * (starl3xx, 2026-11-25: "avg. cost in $WORD to acquire this word … including pack rolls, uppercase
 * rolls, ascension").
 *
 * "Cost to make" is what an average player would spend to build this word as it is NOW, at today's
 * prices, with the average number of tries. It is not what the seller paid (free letters and lucky
 * rolls aren't counted), and not what the word is worth: each word has one owner, so nobody can make
 * this one while it's held. Four parts:
 *
 * - Letters: a pack's price ÷ 5 per draw, scaled by how rare the letter is, `perDraw / (26 × odds)`.
 *   A pack's five letters are then worth, on average, exactly what the pack cost, and a Q (drawn about
 *   one time in 500) costs about 50× an E. Counting packs until you happen to draw the letter would
 *   charge a single Q for the ~499 other letters that came with it.
 * - Raises: each UPPERCASE letter took the average number of rolls (40% first try, +15 points a miss).
 * - Claim: the claim fee.
 * - Ascension: each stage the word has reached took the average number of attempts at that stage's
 *   odds, each paying the stage's fee plus the snack an attempt burns. Failed attempts toward the NEXT
 *   stage are not counted: they don't change what the word is.
 *
 * Every price comes from the caller (the live contract prices in the chain game), so the numbers move
 * with each repeg; the odds come from params, the same numbers the contracts were deployed with.
 * Pure, so the arithmetic is tested (tests/word-cost.test.ts).
 */
import { LETTER_ODDS, TIER_WEIGHT, wordTier } from "./economy";
import { DEFAULT_PARAMS, type Params } from "./params";

/** Whole $WORD, as the game's `price` hands them out. */
export interface CostPrices {
  pack: number;
  roll: number;
  claim: number;
  /** The fee for an ascension attempt FROM `level` (level 0 is the attempt at Gilded 1). */
  prestigeFee: (level: number) => number;
  /** The snack each ascension attempt burns. */
  prestigeSnack: number;
}

export interface CostToMake {
  letters: number;
  raises: number;
  claim: number;
  ascension: number;
  total: number;
}

/** The word as it is now: its letters, which are UPPERCASE, and the stage it has reached. */
export interface WordShape {
  word: string;
  upper: readonly boolean[];
  prestigeLevel: number;
}

/**
 * The average number of tries to succeed when the first try hits at `base`, each miss adds `step`,
 * and the odds stop at `cap`: Σ P(still missing before try k).
 */
export function expectedTries(base: number, step: number, cap: number): number {
  let tries = 0;
  let stillMissing = 1;
  let odds = base;
  for (let k = 0; k < 1000 && stillMissing > 1e-12; k++) {
    tries += stillMissing;
    stillMissing *= 1 - odds;
    odds = Math.min(cap, odds + step);
  }
  return tries;
}

/** The average rolls to raise one letter (about 1.97 at 40% / +15 / 85%). */
export function rollsPerRaise(p: Params = DEFAULT_PARAMS): number {
  return expectedTries(p.roll.baseSuccess, p.roll.pityStep, p.roll.pityCap);
}

/** The average attempts to clear the ascension stage that starts at `level`. */
export function attemptsAtLevel(level: number, p: Params = DEFAULT_PARAMS): number {
  const base = p.prestige.baseByLevel?.[level] ?? p.prestige.baseSuccess;
  return expectedTries(base, p.prestige.pityStep, p.prestige.pityCap);
}

/** One letter's share of a pack: `pack ÷ 5 ÷ (26 × its odds)`. */
export function letterCost(ch: string, pack: number): number {
  const odds = LETTER_ODDS[ch.toUpperCase()];
  if (!odds) return pack / 5;
  return pack / 5 / (26 * odds);
}

export function costToMake(w: WordShape, prices: CostPrices, p: Params = DEFAULT_PARAMS): CostToMake {
  const letters = [...w.word].reduce((a, ch) => a + letterCost(ch, prices.pack), 0);
  const raised = w.upper.filter(Boolean).length;
  const raises = raised * rollsPerRaise(p) * prices.roll;
  let ascension = 0;
  for (let level = 0; level < w.prestigeLevel; level++) {
    ascension += attemptsAtLevel(level, p) * (prices.prestigeFee(level) + prices.prestigeSnack);
  }
  const claim = prices.claim;
  return { letters, raises, claim, ascension, total: letters + raises + claim + ascension };
}

/**
 * What this word would earn in a day, staked and fed, from today's pot: its weight's share once it
 * joins the words already sharing it (`weight`). Only all-UPPERCASE words earn, so others get null.
 * Meant for a word NOT staked now (every word for sale): a staked word is already in `weight`.
 */
export function dailyEarnEstimate(
  w: WordShape,
  today: { pot: number; weight: number },
  p: Params = DEFAULT_PARAMS,
): number | null {
  if (!w.upper.every(Boolean)) return null;
  const mine = TIER_WEIGHT[wordTier(w.word)] * p.prestige.yieldMultPerLevel ** w.prestigeLevel;
  if (!(today.pot > 0) || mine <= 0) return 0;
  return (today.pot * mine) / (Math.max(0, today.weight) + mine);
}

/** A round price to offer as "Use this price": three significant figures (96,958,123 → 97,000,000). */
export function roundPrice(n: number): number {
  if (!(n > 0)) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / magnitude) * magnitude;
}
