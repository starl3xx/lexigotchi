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
import type { ReactNode } from "react";
import { NO_LOOKS } from "@/lib/collabLook";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { CollabLooksContext } from "./collabLooksContext";
import { useSets } from "./useSets";

export function CollabLooksProvider({ children }: { children: ReactNode }) {
  const collab = useSets().collab ?? NO_LOOKS;
  return <CollabLooksContext.Provider value={isChainBacked() ? collab : NO_LOOKS}>{children}</CollabLooksContext.Provider>;
}

export { tileTierOf, useCollabLook } from "./collabLooksContext";
