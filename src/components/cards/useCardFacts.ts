"use client";
/**
 * Everything the back of a word's card says (./CardBack), gathered from the game's own reads. Only
 * a showing back calls it: the word's onchain story (who found it, since when it's yours) is read
 * then, and never for a card nobody turned over.
 *
 * Unknown is never "you", "nothing", or "never": while a read is on its way, or if it failed, the
 * fact says so (`null` here, a dash on the card). Practice words have no chain: their story comes
 * from the practice store (OwnedWord.since), and the player found them all.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Tier } from "@/lib/economy";
import {
  ascensionLabel,
  caseLabel,
  cardDate,
  practiceNumbers,
  earnsStaked,
  foundBy as foundByOf,
  shortTokenId,
  tierCount,
  wordPoints,
  yoursSince,
  type FoundBy,
} from "@/lib/cardFacts";
import type { StoryResponse } from "@/app/api/words/story/route";
import { hunger, useGame, type Hunger, type OwnedWord } from "../game/state";
import { useCostToMake } from "../game/WordValue";
import { usePlayerWallets } from "../game/usePlayerWallets";
import { useWorld } from "../game/useWorld";
import { useSets } from "../game/useSets";
import { useTierCounts, useTierOf } from "@/components/game/useRarity";

export interface CardFacts {
  tier: Tier;
  /** How many words share its tier. */
  ofTier: number;
  /** Its card number: its place in the order words were first made (#1 the first), or null while unknown. */
  number: number | null;
  caseLabel: string;
  ascension: string;
  level: number;
  staked: boolean;
  mood: Hunger;
  /** "25 Nov 2026", or null while its story loads (or couldn't be read). */
  since: string | null;
  /** Who first found it; for someone else, their name when the game knows it. */
  found: FoundBy & { name?: string };
  /** $WORD it has earned the player, or null while earnings load. */
  earned: number | null;
  /** About what it earns a day staked: null while loading or not knowable; "upper" when it can't earn until UPPERCASE. */
  perDay: number | "upper" | null;
  /** About what it costs to make now, or null while prices load. */
  cost: number | null;
  /** Its draw number if the jackpot has drawn it, "never", or null when not known. */
  drawn: number | "never" | null;
  points: number;
  token: string;
  /** The reserved set it was released in (decisions.md, "Reserved word sets"), or null: none, or not known yet. */
  set: string | null;
}

export function useCardFacts(word: OwnedWord): CardFacts {
  const tierOf = useTierOf();
  const tierCounts = useTierCounts();
  const g = useGame();
  const chain = g.state.chainBacked;
  const wallets = usePlayerWallets();
  const world = useWorld();
  const cost = useCostToMake(word);
  // The set this word was released in, if any. Unknown reads as none: the back just has no set line.
  const setName = useSets().setNameOf(word.word);
  const practiceWords = g.state.words;
  const practice = useMemo(() => (chain ? {} : practiceNumbers(practiceWords)), [chain, practiceWords]);
  const story = useQuery({
    queryKey: ["story", word.word],
    enabled: chain,
    staleTime: 60_000,
    queryFn: async (): Promise<StoryResponse> => {
      const res = await fetch(`/api/words/story?word=${word.word}`);
      if (!res.ok) throw new Error(`story ${res.status}`);
      return res.json();
    },
  });

  return useMemo(() => {
    const mine = new Set(wallets.map((w) => w.toLowerCase()));
    const s = story.data && story.data.ok && story.data.live ? story.data : null;
    let since: string | null = null;
    let found: CardFacts["found"] = { kind: "unknown" };
    if (!chain) {
      since = word.since ? cardDate(word.since) : null;
      found = { kind: "you" };
    } else if (s) {
      const at = yoursSince(s.transfers, mine);
      since = at ? cardDate(at) : null;
      const f = foundByOf(s.claims, mine);
      found = f.kind === "other" ? { ...f, name: world.data?.profiles?.[f.address]?.username } : f;
    }
    // "Earns staked": staked and fed, among the words sharing today's pot (lib/cardFacts).
    const today = world.data?.yieldToday;
    const est = today ? earnsStaked(word, today, tierOf) : undefined;
    const drawnMap = world.data?.live ? world.data.drawn : undefined;
    return {
      tier: word.tier,
      ofTier: tierCount(word.tier, tierCounts),
      // its place in the order words were first made: the chain's, or in practice the player's own
      number: chain ? (world.data?.live ? (world.data.numbers?.[word.word] ?? null) : null) : (practice[word.word] ?? null),
      caseLabel: caseLabel(word.upper),
      ascension: ascensionLabel(word.prestigeLevel),
      level: word.prestigeLevel,
      staked: word.staked,
      mood: hunger(word),
      since,
      found,
      earned: g.earnings ? (g.earnings.byWord[word.word]?.total ?? 0) : null,
      // A word not yet UPPERCASE can't earn: say so at once, not after the world loads.
      perDay: !word.upper.every(Boolean) ? "upper" : est === undefined || est === null ? null : est,
      cost: cost?.total ?? null,
      // The practice game has no draws: no world, so nothing has been drawn.
      drawn: !chain ? "never" : drawnMap ? (drawnMap[word.word] ?? "never") : null,
      points: wordPoints(word.word),
      token: shortTokenId(word.word),
      set: setName ?? null,
    };
  }, [word, chain, wallets, story.data, world.data, g.earnings, cost, practice, setName, tierOf, tierCounts]);
}
