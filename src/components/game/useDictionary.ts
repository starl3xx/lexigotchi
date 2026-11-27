"use client";
/**
 * What the Dictionary knows about a word, for its list and its word view (decisions.md #31): who
 * has it, and the player's letters to count against it (lib/wordNeed). The Market reads the same
 * (decisions.md #32), so a word is never "one letter away" on one screen and for sale on the other.
 *
 * - **Owners are known only once the world read succeeds** (always, in the practice game, which has
 *   no other players). Until then a word's status is `unknown`: never "unclaimed", and never a
 *   promise that the player can spell it. Telling a player to spell a word someone owns sends them
 *   into an AlreadyClaimed revert (Bugbot on #120).
 * - **A word on the Market's board has an owner, whatever the world read says:** its seller
 *   (lib/dictionaryList `entryStatus`, pure, tested). The board is read live and the world is a
 *   minute old, so a word claimed and listed since then is for sale before the world knows it has
 *   an owner; and the practice stall's sellers are in no world read at all (JAZZY read as
 *   unclaimed there, with a price tag on it). Spell asks the same question here (`statusOf`), so
 *   the Dictionary's "Can spell" stays exactly Spell's list.
 * - **`here` is the connected wallet's letters,** the only ones a claim can spend; `all` is every
 *   wallet of the player. Spell counts the same way.
 */
import { useCallback, useMemo } from "react";
import type { LetterBag } from "@/lib/wordNeed";
import { entryStatus, type EntryStatus } from "@/lib/dictionaryList";
import { mineLower, mineUpper, useGame, type WordListing } from "./state";
import { useMyWallets, useWorld } from "./useWorld";
import { useSets } from "./useSets";

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
  // The stores rebuild these arrays (and the practice store its board) whenever any UI state
  // changes (a sheet opening), so the bags and the listed words are kept by their CONTENTS: the
  // list and its distances recompute when a letter or a listing changes, not when a sheet opens.
  const hereKey = `${lowerHere.join()}|${upperHere.join()}`;
  const allKey = `${state.lower.join()}|${state.upper.join()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const here: LetterBag = useMemo(() => ({ lower: lowerHere, upper: upperHere }), [hereKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all: LetterBag = useMemo(() => ({ lower: state.lower, upper: state.upper }), [allKey]);
  /** With no letters at all (a visitor, a brand-new player) there is nothing to count: entries say who has a word, not what it needs. */
  const hasLetters = useMemo(() => all.lower.some((n) => n > 0) || all.upper.some((n) => n > 0), [all]);

  /** Every word on the Market's board, and whether its seller is the player (any wallet of theirs). */
  const isMine = g.market.isMine;
  const listedKey = g.wordBoard.map((l) => `${l.word}:${l.maker}`).join();
  const listed = useMemo(
    () => new Map(g.wordBoard.map((l) => [l.word, isMine(l.maker)])),
    // `isMine` is rebuilt with the store; it answers from the player's wallets, which `mine` follows
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listedKey, mine],
  );

  // The words held back in sets that haven't unlocked (useSets; null while not known). One rule
  // for every screen: a held word's status is "held", never "open", so Spell, this list, the
  // word view, and the Market's picks all leave it out without each asking.
  const { held, released } = useSets();
  const statusOf = useCallback(
    (word: string): EntryStatus => entryStatus(word, { owned: ownedSet, owners, wallets: mine, listed, ownersKnown, held }),
    [ownedSet, owners, mine, listed, ownersKnown, held],
  );

  /**
   * Who has a word, and their face: the seller of a word on the board (the live read, with the
   * face its listing carries), else the world's owner. Never one's address with the other's face.
   */
  const profiles = world.data?.profiles;
  const holderOf = useCallback(
    (word: string) => {
      const listing = listings.get(word);
      if (listing) return { address: listing.maker, profile: listing.face ?? profiles?.[listing.maker] };
      const owner = owners?.[word];
      return owner ? { address: owner, profile: profiles?.[owner] } : undefined;
    },
    [listings, owners, profiles],
  );

  return {
    ownersKnown,
    checkFailed,
    owners,
    holderOf,
    profiles,
    numbers: world.data?.live ? world.data.numbers : undefined,
    claimedCount: owners ? Object.keys(owners).length : 0,
    ownedSet,
    caseOf,
    listings,
    here,
    all,
    hasLetters,
    statusOf,
    /** How many words the game offers now (the dictionary less the held-back ones), once known. */
    offered: released,
  };
}

/**
 * Open a word, from any list (decisions.md #32): the player's own, in the bag, opens its card;
 * any other opens the word view (sheets/LookupSheet), which says who has it, what it needs, and,
 * when it is for sale, what it costs.
 */
export function useOpenWord(): (word: string) => void {
  const g = useGame();
  const { openSheet } = g;
  const words = g.state.words;
  return useCallback(
    (word: string) => openSheet(words.some((w) => w.word === word) ? { kind: "word", word } : { kind: "lookup", word }),
    [openSheet, words],
  );
}
