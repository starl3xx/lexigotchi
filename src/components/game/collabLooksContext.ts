"use client";
/**
 * The game's word → collab look lookup, as a context (decisions.md, "Collab sets", item 3). Kept
 * apart from its provider (collabLooks.tsx, which reads the sets answer), so the tile itself can
 * ask for a word's look without carrying the sets' fetching into every page that draws a tile (the
 * landing page, a share page).
 *
 * A tree with no provider has no looks: a page outside the game hands a look to the component
 * that draws the word (`look`), as the share page does.
 */
import { createContext, useContext } from "react";
import type { Tier } from "@/lib/economy";
import { NO_LOOKS, tintOf, type CollabLook, type CollabLooks } from "@/lib/collabLook";
import type { TileTier } from "@/lib/rarityFinish";

export const CollabLooksContext = createContext<CollabLooks>(NO_LOOKS);

/**
 * The collab look of `word`, if it has one. `given` is a look the caller already holds: `null`
 * says "none, and don't look it up" (a house card, a word drawn as an example).
 */
export function useCollabLook(word: string | undefined, given?: CollabLook | null): CollabLook | undefined {
  const looks = useContext(CollabLooksContext);
  if (given !== undefined) return given ?? undefined;
  return word ? looks.get(word.toUpperCase()) : undefined;
}

/** What a word's tiles wear: its collab colors in place of its rarity's material, or its rarity. */
export function tileTierOf(tier: Tier | undefined, look: CollabLook | undefined): TileTier | undefined {
  return look ? tintOf(look) : tier;
}
