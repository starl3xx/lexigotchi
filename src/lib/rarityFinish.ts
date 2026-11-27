/**
 * A word's rarity, shown as the material of its letter tiles (decisions.md #23). Shared by the
 * character rig (TileCharacter + TileFinish) and the share card's tile (app/_og/tile.tsx), so both
 * agree.
 *
 * One material per tier, laid over the tile as a translucent tint (the tile's own cream or white
 * shows through), and each tier keeps the last tier's effects and adds more (Marvel Snap's upgrade
 * ladder works the same way):
 *   Uncommon   satin jade      a soft light passes over now and then
 *   Rare       sapphire foil   + brushed foil, a hot spot that follows the pointer, and a glint at
 *                                the edge as the light leaves
 *   Legendary  polished gold   + glitter, an engraved frame, a light circling the rim, soft glints,
 *                                gold motes, a warm aura
 *   Mythic     cut amethyst    + facets the light runs across, and fire: spectral flashes along the
 *                                facet edges (a cut gem's dispersion)
 * Common stays the plain wood tile, and loose letters stay plain: a finish belongs to a word. The
 * rainbow belongs to Mythic's fire and to Holographic ascension, never to a material. Every tier
 * reads from a still frame alone (small word lists, reduced motion, slow devices, the share card).
 */
import type { Tier } from "./economy";
import { READS, contrast, luminance, mixHex } from "./contrast";

/**
 * "collab" is not a rarity's material: it is the shared collab stock, tinted with a partner set's
 * two colors (lib/collabLook.ts `collabFinish`). It has no entry in `FINISH`; a tile is given it
 * in place of its rarity's material.
 */
export type FinishMaterial = "satin" | "foil" | "gold" | "amethyst" | "collab";

export interface Finish {
  material: FinishMaterial;
  /** the material, top left to bottom right */
  face: string[];
  /** how strongly the material tints the tile; the tile's own face shows through the rest */
  alpha: number;
  /** the light it gives off: glints, motes, aura */
  glow: string;
  /** a darker shade of the material, for engraving and facet edges */
  deep: string;
  /** seconds between passes of light over the tile */
  period: number;
}

export const FINISH: Partial<Record<Tier, Finish>> = {
  Uncommon: { material: "satin", face: ["#d9f3e8", "#b4e6d3", "#93d8bf"], alpha: 0.6, glow: "#a6f3dc", deep: "#4fa58e", period: 10 },
  Rare: { material: "foil", face: ["#e6f1ff", "#a9cbf5", "#6f9fe0"], alpha: 0.6, glow: "#bcdcff", deep: "#3f74c4", period: 9 },
  // polished metal: light and dark bands, as a curved gold surface reflects
  Legendary: { material: "gold", face: ["#fff1bd", "#f7cf5c", "#dca22a", "#f4c64c", "#ffe9a6"], alpha: 0.7, glow: "#ffd877", deep: "#8f600a", period: 8 },
  Mythic: { material: "amethyst", face: ["#eedfff", "#cdaaf8", "#a77ce8"], alpha: 0.66, glow: "#d6b2ff", deep: "#5d34a8", period: 7 },
};

/**
 * A collab set's two colors, "#rrggbb" each, as a tile is given them (lib/collabLook.ts). A tile's
 * `tier` prop takes this IN PLACE of a rarity: the collab stock takes the place of the rarity's
 * material (decisions.md, "Collab sets", item 3). The tile's border still follows its case, and
 * its rings and rainbow its ascension: neither reads this.
 */
export interface CollabTint {
  a: string;
  b: string;
}

/** What a tile's material is chosen by: its word's rarity, or its word's collab colors. */
export type TileTier = Tier | CollabTint;

/** A tile's own face and letter ink by case (TileCharacter.tsx; tests/collab-look.test.ts holds them equal). */
export const TILE_CASE = {
  upper: { face: "#ffffff", ink: "#111827" },
  lower: { face: "#f8efdd", ink: "#2a1e1a" },
} as const;

/** How strongly the collab stock tints a tile, strongest first. The last is barely a tint: a letter reads on it over any color. */
const TINTS = [0.62, 0.5, 0.4, 0.3, 0.22, 0.14, 0.08];

/**
 * The collab stock on a TILE: the two colors as one diagonal tint over the tile's own face. The
 * two colors are ANY two colors (an operator types them), and the letter keeps its own ink (it
 * belongs to the case, as the border does), so the tint is thinned until the letter reads on both
 * cases, at both ends of the tint and in its middle. It has no metal, foil, or facets, no halo and
 * no motes: it is a stock, not a material. A light still passes over it.
 */
export function collabFinish(tint: CollabTint): Finish {
  const mid = mixHex(tint.a, tint.b, 0.5);
  const stops = [tint.a, mid, tint.b];
  const reads = (alpha: number) =>
    (["upper", "lower"] as const).every((k) => stops.every((c) => contrast(TILE_CASE[k].ink, mixHex(TILE_CASE[k].face, c, alpha)) >= READS));
  const alpha = TINTS.find(reads) ?? TINTS[TINTS.length - 1];
  const [dark, light] = luminance(tint.a) <= luminance(tint.b) ? [tint.a, tint.b] : [tint.b, tint.a];
  return {
    material: "collab",
    face: stops,
    alpha,
    // the light it gives off, and the shade for what is drawn around it: from its own two colors
    glow: mixHex(light, "#ffffff", 0.45),
    deep: mixHex(dark, "#1b1714", 0.35),
    period: 9,
  };
}

/**
 * Is this a POLISHED surface: one that shows a hot spot where a light rests on it, and catches the
 * light on its edge as a pass leaves? Foil, gold, and amethyst are. Satin isn't (a soft sheen), and
 * the collab stock isn't either: it is a matte tint, with no metal to shine (Bugbot on #302: it
 * had the polished highlight, while the small tiles already left the gloss off).
 */
export function polished(fin: Finish): boolean {
  return fin.material !== "satin" && fin.material !== "collab";
}

/** A list of words draws hundreds of tiles: each pair of colors is worked out once. */
const collabFinishes = new Map<string, Finish>();

export function finishFor(tier: TileTier | undefined): Finish | undefined {
  if (!tier) return undefined;
  if (typeof tier === "string") return FINISH[tier];
  const key = `${tier.a}${tier.b}`;
  let fin = collabFinishes.get(key);
  if (!fin) {
    if (collabFinishes.size > 200) collabFinishes.clear(); // an admin dragging a color picker makes many pairs
    collabFinishes.set(key, (fin = collabFinish(tier)));
  }
  return fin;
}

export { mixHex };
