"use client";
/**
 * A word's rarity as the game treats it, for a component (lib/rarity.ts; decisions.md, "Collab
 * sets", item 2): the derived tier, with a collab word raised to Legendary from its set's reveal.
 *
 * The collab words come with the sets answer (useSets), which arrives after the first paint. Until
 * then every word shows its derived tier; when the answer lands, these hooks give new functions, so
 * whatever drew a tier draws it again. A component asks `useTierOf()` and never `wordTier` (the
 * derived tier): tests/rarity-override.test.ts holds the list of files that still may.
 */
import { useMemo } from "react";
import type { Tier } from "@/lib/economy";
import { NO_COLLAB, tierCountsWith, tierFn } from "@/lib/rarity";
import { useSets } from "./useSets";

/** `(word) => Tier`, as the game treats it now. Stable until the collab words change. */
export function useTierOf(): (word: string) => Tier {
  const collab = useSets().collab ?? NO_COLLAB;
  return useMemo(() => tierFn(collab), [collab]);
}

/** How many words are in each tier, by the same rule ("one of N Legendary words"). */
export function useTierCounts(): Record<Tier, number> {
  const collab = useSets().collab ?? NO_COLLAB;
  return useMemo(() => tierCountsWith(collab), [collab]);
}
