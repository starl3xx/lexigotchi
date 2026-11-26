/**
 * A card back's material, one per tier (globals.css, `.cb.m-*`): the same five the tiles wear
 * (lib/rarityFinish), deep, so cream type and light tiles read on them.
 */
import type { Tier } from "@/lib/economy";

export type CardMaterial = "common" | "uncommon" | "rare" | "legendary" | "mythic";

const MATERIAL: Record<Tier, CardMaterial> = {
  Common: "common",
  Uncommon: "uncommon",
  Rare: "rare",
  Legendary: "legendary",
  Mythic: "mythic",
};

/** Each material's line colour (globals.css `.m-*`, --cb-line): the back's frame, the pressed seal, and the holder's stamp are in it. */
export const MATERIAL_LINE: Record<CardMaterial, string> = { common: "#9a8164", uncommon: "#5cc4a9", rare: "#7fb0ef", legendary: "#e9b949", mythic: "#b48cf0" };

export function materialOf(tier: Tier): CardMaterial {
  return MATERIAL[tier];
}

/** Gold's engraved scrollwork for a back's corner, in a 40×40 box (the top-left; CSS mirrors the rest). */
export const SCROLL_PATH_CARD = "M3 37 C3 18 8 8 18 4 C24 2 30 3 37 3 M10 25 C9 16 15 11 21 13 C26 15 25 22 20 22 C16 22 16 18 19 17";
