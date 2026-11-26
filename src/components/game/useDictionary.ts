"use client";
/**
 * What the Dictionary knows about a word, for its list and its word view (decisions.md #30): who
 * has it, and the player's letters to count against it (lib/wordNeed).
 *
 * - **Owners are known only once the world read succeeds** (always, in the practice game, which has
 *   no other players). Until then a word's status is `unknown`: never "unclaimed", and never a
 *   promise that the player can spell it. Telling a player to spell a word someone owns sends them
 *   into an AlreadyClaimed revert (Bugbot on #120).
 * - **`here` is the connected wallet's letters,** the only ones a claim can spend; `all` is every
 *   wallet of the player. Spell counts the same way.
 */
import { useCallback, useMemo } from "react";
import type { LetterBag } from "@/lib/wordNeed";
import type { EntryStatus } from "@/lib/dictionaryList";
import { mineLower, mineUpper, useGame, type WordListing } from "./state";
import { useMyWallets, useWorld } from "./useWorld";


export function useDictionary() {
  const g = useGame();
  const { state } = g;
  const world = useWorld();
  const mine = useMyWallets();
  const owners = world.data?.owners;
  const ownersKnown = !state.chainBacked || world.data?.live === true;
  /** A failed read is not a check in progress: say so (the read retries on its own). */
  const checkFailed = !ownersKnown && (world.isError || (!!world.data && !world.data.live));

  const ownedSet = useMemo(() => new Set(state.words.map((w) => w.word)), [state.words]);
  const caseOf = useMemo(() => new Map(state.words.map((w) => [w.word, w.upper])), [state.words]);
  const listings = useMemo(() => new Map<string, WordListing>(g.wordBoard.map((l) => [l.word, l])), [g.wordBoard]);

  const lowerHere = mineLower(state);
  const upperHere = mineUpper(state);
  // The chain store rebuilds these arrays whenever any UI state changes (a sheet opening), so the
  // bags are kept by their CONTENTS: the list and its distances recompute when a letter changes,
  // not when a sheet opens.
  const hereKey = `${lowerHere.join()}|${upperHere.join()}`;
  const allKey = `${state.lower.join()}|${state.upper.join()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const here: LetterBag = useMemo(() => ({ lower: lowerHere, upper: upperHere }), [hereKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all: LetterBag = useMemo(() => ({ lower: state.lower, upper: state.upper }), [allKey]);
  /** With no letters at all (a visitor, a brand-new player) there is nothing to count: entries say who has a word, not what it needs. */
  const hasLetters = useMemo(() => all.lower.some((n) => n > 0) || all.upper.some((n) => n > 0), [all]);

  const statusOf = useCallback(
    (word: string): EntryStatus => {
      if (ownedSet.has(word)) return "mine";
      const owner = owners?.[word];
      if (owner && mine.has(owner)) return "mineAway";
      if (owner) return listings.has(word) ? "sale" : "taken";
      return ownersKnown ? "open" : "unknown";
    },
    [ownedSet, owners, mine, listings, ownersKnown],
  );

  return {
    ownersKnown,
    checkFailed,
    owners,
    profiles: world.data?.profiles,
    numbers: world.data?.live ? world.data.numbers : undefined,
    claimedCount: owners ? Object.keys(owners).length : 0,
    ownedSet,
    caseOf,
    listings,
    here,
    all,
    hasLetters,
    statusOf,
  };
}
