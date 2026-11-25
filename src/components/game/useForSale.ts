"use client";
/**
 * The bag's words that are for sale in the Market (decisions.md #18), word → price in whole $WORD.
 * A word is one token, and the board only lists words their current holder can sell, so a bag word
 * on the board is one this player listed. Empty in practice mode (no board).
 */
import { useMemo } from "react";
import { useGame } from "./state";

export function useForSale(): ReadonlyMap<string, number> {
  const { wordBoard, state } = useGame();
  return useMemo(() => {
    const mine = new Set(state.words.map((w) => w.word));
    return new Map(wordBoard.filter((l) => mine.has(l.word)).map((l) => [l.word, l.price] as const));
  }, [wordBoard, state.words]);
}
