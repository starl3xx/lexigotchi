"use client";
/**
 * A word's collab look, wherever a word is drawn in the game (lib/collabLook.ts; decisions.md,
 * "Collab sets", item 3). A collab is a look that belongs to the WORD and travels with it, so the
 * components that draw a word (its tiles, its small tiles, its card) ask for it by the word, here,
 * and no screen has to pass it along: Today, the bag, the Dictionary, the Market, a sheet.
 *
 * The looks come with the sets answer (useSets): one read for the whole game, given to every tile
 * through a context (a list draws hundreds of tiles; none of them asks the server). They arrive
 * after the first paint, and every tile draws again when they do. A draft's look is never in the
 * answer. The practice game has no sets, so it has no looks.
 *
 * A tree with no provider (a page outside the game, a test) has no looks either; such a page
 * hands a look to the component itself (`look`), as the share page does.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Tier } from "@/lib/economy";
import { NO_LOOKS, tintOf, type CollabLook, type CollabLooks } from "@/lib/collabLook";
import type { TileTier } from "@/lib/rarityFinish";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { useSets } from "./useSets";

const Looks = createContext<CollabLooks>(NO_LOOKS);

export function CollabLooksProvider({ children }: { children: ReactNode }) {
  const collab = useSets().collab ?? NO_LOOKS;
  return <Looks.Provider value={isChainBacked() ? collab : NO_LOOKS}>{children}</Looks.Provider>;
}

/**
 * The collab look of `word`, if it has one. `given` is a look the caller already holds: `null`
 * says "none, and don't look it up" (a house card, a word drawn as an example).
 */
export function useCollabLook(word: string | undefined, given?: CollabLook | null): CollabLook | undefined {
  const looks = useContext(Looks);
  if (given !== undefined) return given ?? undefined;
  return word ? looks.get(word.toUpperCase()) : undefined;
}

/** What a word's tiles wear: its collab colors in place of its rarity's material, or its rarity. */
export function tileTierOf(tier: Tier | undefined, look: CollabLook | undefined): TileTier | undefined {
  return look ? tintOf(look) : tier;
}
