"use client";
/**
 * Reserved word sets, as any visitor may see them (GET /api/dictionary/sets; decisions.md,
 * "Reserved word sets"): locked slots, revealed sets, released sets, and the words held back now.
 * Asked again every minute, and every few seconds around a set's unlock.
 *
 * **Unknown is not "none".** While the read is loading or has failed, `known` is false and nothing
 * here says there are no sets: a screen shows no Sets section then, and a card's back simply has
 * no set line.
 */
import { useContext, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import type { SetsPayload } from "@/app/api/dictionary/sets/route";
import { releasedSetNames, setsPollMs } from "./sets";
import { collabLooksOf } from "@/lib/collabLook";

/**
 * A client that never fetches, for a render with no query client at all. This hook is read by the
 * hooks half the game shares (useDictionary, useTakenWords), and many component tests render one
 * sheet with no providers: there the sets are simply unknown, as they are while loading. The game
 * itself always has a client (Providers.tsx).
 */
const IDLE = new QueryClient();

export function useSets() {
  const client = useContext(QueryClientContext);
  const q = useQuery(
    {
      enabled: client !== undefined,
      queryKey: ["sets"],
      queryFn: async (): Promise<SetsPayload> => {
        const res = await fetch("/api/dictionary/sets");
        if (!res.ok) throw new Error(`sets ${res.status}`);
        return res.json();
      },
      staleTime: 5_000,
      // Faster while a revealed set is about to unlock (sets.ts setsPollMs says why).
      refetchInterval: (query) => setsPollMs(query.state.data?.sets ?? [], Date.now()),
    },
    client ?? IDLE,
  );
  const sets = q.data?.sets;
  const names = useMemo(() => releasedSetNames(sets ?? []), [sets]);
  const heldList = q.data?.held;
  /** The words held back now, or null while that isn't known (then nothing is called held). */
  const held = useMemo(() => (heldList ? new Set(heldList) : null), [heldList]);
  /**
   * Every word of a revealed or released collab set, with its card look (lib/collabLook.ts): what
   * raises a word to Legendary (lib/rarity.ts) and what its card is drawn in. One object for both.
   */
  const collab = useMemo(() => collabLooksOf(sets ?? []), [sets]);
  return {
    held,
    collab,
    known: q.data?.ok === true,
    sets: sets ?? [],
    /** The name of the released set a word belongs to, if any. */
    setNameOf: (word: string) => names.get(word.toUpperCase()),
    /** How many words the game offers now, once known. */
    released: q.data?.released ?? undefined,
    gate: q.data?.gate === true,
  };
}

/** The time, kept to the minute: what a countdown line needs, and no more. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
