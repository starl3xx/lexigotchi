"use client";
/**
 * What a "your words" list shows while the player's words aren't known: on their way, or the read
 * failed. Either way "no words yet" would be wrong for a returning player, so the Bag shows this
 * instead of its empty state (Bugbot on #164), as the Today stage does with
 * its own bubble (TodayStage's EmptyStage, same words).
 */
import { Button } from "./primitives";
import { useGame } from "./state";

/** The failed read, said plainly: it isn't a change to what the player owns. */
export const WORDS_READ_FAILED = "We couldn’t bring out your words. That’s a connection problem, not a change to what you own.";

/** Are the words unknown right now (still loading, or the read failed)? */
export function wordsUnknown(state: { wordsLoading?: boolean; wordsError?: boolean }): boolean {
  return Boolean(state.wordsLoading || state.wordsError);
}

export function WordsPending() {
  const g = useGame();
  const { state } = g;
  if (state.wordsLoading) {
    return (
      <p aria-busy className="py-6 text-center text-sm text-ink/70">
        Bringing out your words…
      </p>
    );
  }
  if (!state.wordsError) return null;
  return (
    <div role="status" className="space-y-3 py-4 text-center">
      <p className="text-sm text-ink/70">{WORDS_READ_FAILED}</p>
      <Button variant="ghost" onClick={() => g.reloadWords?.()}>
        Try again
      </Button>
    </div>
  );
}
