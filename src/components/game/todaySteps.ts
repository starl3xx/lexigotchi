/**
 * What a player can do next, from their own bag, for the Today tab's "Your next steps".
 *
 * starl3xx: "the Today tab needs to guide the user in what actions are available for them... if I
 * have a word that's spelled but unstaked, I should see something that informs me of that and lets
 * me do it from the Today tab; same with rolling letters to uppercase in already-spelled words".
 *
 * Pure, so the rules are tested (tests/today-steps.test.ts). Feeding, the daily letter, and
 * unfinished reveals keep their own Today cards, so they aren't repeated here. Only the connected
 * wallet's words (`mine`) appear: a linked wallet's word can't be staked or rolled from here.
 */
import type { OwnedWord } from "./state";
import { spellableNow } from "./state";

export type NextStep =
  | { kind: "rewards"; amount: number }
  | { kind: "stake"; word: string; earns: boolean }
  | { kind: "spell"; word: string; upper: boolean }
  | { kind: "roll"; word: string; pos: number; letter: string; odds: number }
  | { kind: "start" };

export interface NextStepsInput {
  words: readonly OwnedWord[];
  claimables: readonly { amount: number }[];
  /** The connected wallet's own loose letters, 26 counts each (mineLower / mineUpper). */
  lower: number[];
  upper: number[];
  /** Per-letter roll pity (A..Z) and the odds it gives. */
  pity: readonly number[];
  rollProb: (pity: number) => number;
}

/** Most items per kind, so the card stays a short list and not the whole bag. */
const MAX = { stake: 3, spell: 2, roll: 2 } as const;

export function nextSteps(i: NextStepsInput): NextStep[] {
  const steps: NextStep[] = [];
  const mine = i.words.filter((w) => w.mine);

  const rewards = i.claimables.reduce((a, c) => a + c.amount, 0);
  if (rewards > 0) steps.push({ kind: "rewards", amount: rewards });

  // Unstaked words: staking is what enters a word in the jackpot (and lets an UPPERCASE one earn).
  // Fully UPPERCASE words first: they also start earning.
  const unstaked = mine
    .filter((w) => !w.staked)
    .sort((a, b) => Number(b.upper.every(Boolean)) - Number(a.upper.every(Boolean)));
  for (const w of unstaked.slice(0, MAX.stake)) steps.push({ kind: "stake", word: w.word, earns: w.upper.every(Boolean) });

  // Words the loose letters spell right now. UPPERCASE first: such a word is born earning.
  const owned = new Set(i.words.map((w) => w.word));
  const upperSpells = spellableNow(i.upper, owned, 1);
  for (const word of upperSpells) steps.push({ kind: "spell", word, upper: true });
  for (const word of spellableNow(i.lower, owned, MAX.spell - upperSpells.length)) steps.push({ kind: "spell", word, upper: false });

  // Letters to raise inside words: staked words first (they earn once fully UPPERCASE), then the
  // closest to done. In each word, the lowercase letter with the best odds (pity is per letter).
  const raisable = mine
    .filter((w) => !w.upper.every(Boolean))
    .sort((a, b) => Number(b.staked) - Number(a.staked) || b.upper.filter(Boolean).length - a.upper.filter(Boolean).length);
  for (const w of raisable.slice(0, MAX.roll)) {
    let best: { pos: number; odds: number } | null = null;
    [...w.word].forEach((ch, pos) => {
      if (w.upper[pos]) return;
      const odds = i.rollProb(i.pity[ch.toUpperCase().charCodeAt(0) - 65] ?? 0);
      if (!best || odds > best.odds) best = { pos, odds };
    });
    if (best) {
      const b = best as { pos: number; odds: number };
      steps.push({ kind: "roll", word: w.word, pos: b.pos, letter: w.word[b.pos].toUpperCase(), odds: b.odds });
    }
  }

  // An empty bag: nothing above applies, so point at the start.
  const letters = i.lower.reduce((a, b) => a + b, 0) + i.upper.reduce((a, b) => a + b, 0);
  if (mine.length === 0 && letters === 0) steps.push({ kind: "start" });

  return steps;
}
