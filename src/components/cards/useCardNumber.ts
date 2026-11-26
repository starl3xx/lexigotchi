"use client";
/**
 * A word's card number for the front of its card (the ribbon letters it: "No. 0020"): its place in
 * the order words were first made. One small read for all of the player's words
 * (`/api/words/numbers`), not the whole world: the front shows on Today, on every visit.
 *
 * Null while it isn't known (loading, a failed read, a word made a moment ago): the ribbon leaves
 * the number out. The practice game has no chain, so it numbers the player's own words by when
 * each came to them (lib/cardFacts, practiceNumbers), as its card backs do.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { practiceNumbers } from "@/lib/cardFacts";
import { useGame } from "../game/state";

export function useCardNumbers(): Record<string, number> {
  const { state } = useGame();
  const chain = state.chainBacked;
  const names = useMemo(() => [...new Set(state.words.map((w) => w.word))].sort(), [state.words]);
  const practice = useMemo(() => (chain ? {} : practiceNumbers(state.words)), [chain, state.words]);
  const read = useQuery({
    queryKey: ["cardNumbers", names.join(",")],
    enabled: chain && names.length > 0,
    staleTime: 60_000,
    // a word made a moment ago has no number for up to a minute: ask again until every word has one
    refetchInterval: (q) => (names.every((w) => q.state.data?.[w]) ? false : 60_000),
    queryFn: async (): Promise<Record<string, number>> => {
      // the route takes a short list (it answers for any caller): a large bag asks in parts
      const parts: string[][] = [];
      for (let i = 0; i < names.length; i += WORDS_PER_ASK) parts.push(names.slice(i, i + WORDS_PER_ASK));
      const answers = await Promise.all(
        parts.map(async (part) => {
          const res = await fetch(`/api/words/numbers?words=${part.join(",")}`);
          if (!res.ok) throw new Error(`numbers ${res.status}`);
          return ((await res.json()) as { numbers?: Record<string, number> }).numbers ?? {};
        }),
      );
      return Object.assign({}, ...answers);
    },
  });
  return chain ? (read.data ?? EMPTY) : practice;
}
const EMPTY: Record<string, number> = {};
/** Under the route's own limit (200), with room to spare. */
export const WORDS_PER_ASK = 150;

export function useCardNumber(word: string | undefined): number | null {
  const numbers = useCardNumbers();
  return (word && numbers[word]) || null;
}
