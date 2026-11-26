"use client";
import { useCallback, useState } from "react";

/**
 * Whether a card is turned over, for WHAT is shown now (`key`): a word, and whether it is shown
 * bare or in its case (two components: one that takes the other's place starts on its front).
 * When the key changes, the answer is "not turned" on the very first render with the new key, and
 * the old key's turn is forgotten: whatever takes a card's place always mounts on its front, so
 * remembering a turn for later would disagree with what is on screen.
 *
 * It is derived during the render on purpose. Resetting the flag in an effect runs after the
 * paint, so a card taken out of its case mounted on its back and then turned itself to the front
 * (Bugbot on #236).
 */
export function useFlipOf(key: string | null): [boolean, (back: boolean) => void] {
  const [turn, setTurn] = useState<{ key: string | null; back: boolean }>({ key, back: false });
  // Something else is shown: it starts on its front. Set while rendering (React renders again
  // before it paints), never in an effect.
  if (turn.key !== key) setTurn({ key, back: false });
  const set = useCallback((back: boolean) => setTurn({ key, back }), [key]);
  return [turn.key === key && key !== null && turn.back, set];
}

/** The key for a word's card as it is shown: bare, or in its case. */
export function flipKey(word: string, cased: boolean): string {
  return `${word}|${cased ? "case" : "card"}`;
}
