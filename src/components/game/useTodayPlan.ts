"use client";
/**
 * What Today's cards must agree on, in one place, so the stage, the letters card, and next steps
 * never tell a player different things: which words they can't claim, whether their letters spell
 * one they can, and what the empty stage says.
 */
import { useMemo } from "react";
import { mineLower, mineUpper, spellableNow, useGame } from "./state";
import { useWorld } from "./useWorld";
import { useSets } from "./useSets";
import { emptyStageCase, type EmptyStageCase } from "./stagePick";

/**
 * Words the player can't claim: their own, every word another player owns (the world read), every
 * word held back in a set that hasn't unlocked, and every word on the Market's board, which is its seller's whatever the minute-old world read says
 * (decisions.md #32; lib/dictionaryList `entryStatus`). Spell, the Dictionary, and the Market count
 * the same way, since a claim of an owned word reverts. Until the world read lands, only their own
 * and the board's.
 */
export function useTakenWords(): Set<string> {
  const g = useGame();
  const { state } = g;
  const owners = useWorld().data?.owners;
  // the practice store rebuilds its board with every state change: keep the set by its contents
  const listed = g.wordBoard.map((l) => l.word).join();
  // Held back in a set that hasn't unlocked: nobody's, and still not claimable (decisions.md,
  // "Reserved word sets"). Counted here so no next step, and no "your letters now spell…", names one.
  const { held } = useSets();
  return useMemo(
    () => new Set([...state.words.map((w) => w.word), ...Object.keys(owners ?? {}), ...(listed ? listed.split(",") : []), ...(held ?? [])]),
    [state.words, owners, listed, held],
  );
}

/** Do the connected wallet's loose letters spell a word nobody owns yet (in any mix of cases)? */
export function useCanSpell(): boolean {
  const { state } = useGame();
  const taken = useTakenWords();
  const upper = mineUpper(state);
  const lower = mineLower(state);
  return useMemo(() => spellableNow(lower, upper, taken, 1).length > 0, [upper, lower, taken]);
}

/** What the empty Today stage says to this player (stagePick.ts, emptyStageCase). */
export function useEmptyStageCase(): EmptyStageCase {
  const { state } = useGame();
  const canSpell = useCanSpell();
  const letters = [...mineLower(state), ...mineUpper(state)].reduce((a, b) => a + b, 0);
  return emptyStageCase({
    loading: Boolean(state.wordsLoading),
    error: Boolean(state.wordsError),
    words: state.words.length,
    mineWords: state.words.filter((w) => w.mine).length,
    letters,
    canSpell,
  });
}
