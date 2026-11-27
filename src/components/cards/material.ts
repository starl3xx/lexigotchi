/**
 * A card back's inks, one set per tier (globals.css, `.cb.m-*`): deep, so cream type and light
 * tiles read on them. A back is an engraved PLATE in those inks (lib/cardArt/plate; decisions.md
 * #58: "the cards are matte", "13A dark plate is definitely the way to go"). The names are the
 * tiers'; "material" is kept from when a back was satin, foil, gold, and a cut gem (#25, #26),
 * because a hundred lines and every stored class say it.
 */
import type { Tier } from "@/lib/economy";
import { backPlate, type PlateEdge } from "@/lib/cardArt/plate";

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

/** Each material's ground: the dark ink its back is printed solid in (globals.css `.m-*`, --cb-base; tests/matte-cards.test.ts holds the two equal). */
export const MATERIAL_GROUND: Record<CardMaterial, string> = { common: "#2a2019", uncommon: "#0e3a31", rare: "#0b1f40", legendary: "#2e2006", mythic: "#1d0d36" };

/** The ink Mythic's violet blends to along the card, and back: its magenta. No other plate has a second ink. */
const MYTHIC_SECOND = "#ff9ad5";

/**
 * Each rarity's border: plain rules for Common, and ONE border of lace for every other (the owner,
 * 2026-11-27: "the 'border of lace' on uncommon and rare should be the border on the back of every
 * one but common"). A rarity above Common is told by its inks alone.
 */
const PLATE_EDGE: Record<CardMaterial, PlateEdge> = { common: "rules", uncommon: "lace", rare: "lace", legendary: "lace", mythic: "lace" };

export function materialOf(tier: Tier): CardMaterial {
  return MATERIAL[tier];
}

/** A rarity's back plate, as SVG markup for svgDoc. Mythic's ink changes along the card (a banknote's rainbow printing: printed, so it never moves). */
export function materialPlate(m: CardMaterial): string {
  return backPlate(PLATE_EDGE[m], { ground: MATERIAL_GROUND[m], line: MATERIAL_LINE[m], second: m === "mythic" ? MYTHIC_SECOND : MATERIAL_LINE[m] }, m === "mythic");
}

/**
 * A collab set's back plate: the border of lace every back but Common's carries, printed in the
 * set's own colors, as lib/collabLook `collabBack` deepens them. Its two
 * colors are its two grounds: the field in one and the border in the other, flat, as a note is
 * printed in two inks (the back was a soft blend of the two). Its engraving is one line ink, which
 * `collabBack` already makes read on both.
 */
export function collabPlate(back: { base: string; base2: string; line: string }): string {
  return backPlate("lace", { ground: back.base, band: back.base2, line: back.line, second: back.line });
}
