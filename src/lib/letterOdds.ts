/**
 * Each letter's odds in a draw (starl3xx, 2026-11-25: the Mint tab should show "the actual odds %
 * per letter", the whole alphabet). Pure: no secrets, no chain, so the browser can use it.
 *
 * A draw picks one letter by weight. A letter's weight is its share of the dictionary's letter
 * slots (economy.ts LETTER_ODDS), or 0 once none of it can be minted: a sold-out letter leaves the
 * draw and every other letter comes up more often. `letterWeights` is THE weight: the signer's
 * `drawLetters` (lib/onchain/signer.ts) calls it, and the Mint tab shows it normalized, so what the
 * screen says can't drift from what a pack does.
 */
import { ALPHABET, LETTER_ODDS } from "./economy";

/** A pack is this many draws (Letters' packs of 5). A daily letter is one. */
export const PACK_DRAWS = 5;

/**
 * The draw's weight for each letter, A to Z: its dictionary share while any of it is left
 * (`available[i]` = cap − minted ever), else 0. NOT normalized, on purpose: `drawLetters` sums these
 * as they are, and its arithmetic must not change (tests/draw-pinned.test.ts holds its outputs).
 */
export function letterWeights(available: readonly number[]): number[] {
  return ALPHABET.map((ch, i) => ((available[i] ?? 0) > 0 ? (LETTER_ODDS[ch] ?? 0) : 0));
}

/**
 * Each letter's chance in ONE draw, A to Z, adding up to 1. Without `available` every letter is
 * open (the practice game, and the chain game until its supply read lands). All zeros when nothing
 * is left to draw.
 */
export function letterOdds(available?: readonly number[]): number[] {
  const weights = available ? letterWeights(available) : ALPHABET.map((ch) => LETTER_ODDS[ch] ?? 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 0);
}

/** "10.4%" from 1% up, "0.20%" below it: one decimal would round q (0.20%) and j (0.31%) together. */
export function fmtOdds(p: number): string {
  const pct = p * 100;
  return `${pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}

/** About one pack in this many holds at least one of a letter drawn at `p` (each of its draws is independent). */
export function packsPer(p: number, draws = PACK_DRAWS): number {
  if (!(p > 0)) return Infinity;
  return 1 / (1 - (1 - Math.min(1, p)) ** draws);
}

/**
 * A letter is running LOW when a tenth of its supply or less is left to mint. A share of the cap,
 * never a fixed count: q's cap is in the hundreds and e's in the thousands. The cap is the chain's
 * (readLetterSupply), not economy.ts's, because a deployed Letters can hold older caps.
 */
export const LOW_SHARE = 0.1;
export const isLow = (left: number, cap: number): boolean => left > 0 && cap > 0 && left <= cap * LOW_SHARE;
