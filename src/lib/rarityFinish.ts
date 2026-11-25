/**
 * A word's rarity, shown as the material of its letter tiles (decisions.md #22). Shared by the
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

export type FinishMaterial = "satin" | "foil" | "gold" | "amethyst";

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

export const finishFor = (tier: Tier | undefined): Finish | undefined => (tier ? FINISH[tier] : undefined);

/** Two hex colors mixed: t = 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
