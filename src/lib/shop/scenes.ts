/**
 * The Shop's scenes (decisions.md #41): which scenes a profile has bought, and which are on sale.
 * Pure, so the rule that says what grants a paid scene is tested.
 *
 * **What grants a scene:** an item in the profile's wardrobe whose `shop_items` row says it is a
 * scene (`kind` "scene") and names the scene in `art` (a Shop scene's id: lib/scenes, SHOP_SCENES).
 * Nothing else does. An item with no row grants nothing (the test network's placeholder "Test
 * item" has none), nor does a row of another kind, nor a row that names a scene the Shop doesn't
 * sell (a free scene can't be "sold", and a typo grants nothing).
 */
import { SHOP_SCENES, type SceneId } from "../scenes";
import { availability, type ItemMeta, type RegistryItem } from "./rules";

/** The Shop scene an item is, or null when it isn't one. */
export function sceneOfItem(meta: ItemMeta | null | undefined): SceneId | null {
  if (!meta || meta.kind !== "scene" || !meta.art) return null;
  return (SHOP_SCENES as readonly string[]).includes(meta.art) ? (meta.art as SceneId) : null;
}

/** The Shop scenes a wardrobe holds: `owned` is item id → how many the profile has bought. */
export function boughtScenes(owned: ReadonlyMap<number, number>, metaOf: (itemId: number) => ItemMeta | null | undefined): Set<SceneId> {
  const out = new Set<SceneId>();
  for (const [itemId, count] of owned) {
    if (count <= 0) continue;
    const scene = sceneOfItem(metaOf(itemId));
    if (scene) out.add(scene);
  }
  return out;
}

/**
 * The Shop scenes that can be bought right now, each with its item (the cheapest, when two items
 * sell the same scene): what the scene picker offers a player who doesn't have the scene.
 */
export function scenesOnSale(items: readonly RegistryItem[], metaOf: (itemId: number) => ItemMeta | null | undefined, nowSec: number): Map<SceneId, RegistryItem> {
  const out = new Map<SceneId, RegistryItem>();
  for (const item of items) {
    const scene = sceneOfItem(metaOf(item.id));
    if (!scene || availability(item, nowSec) !== "on_sale") continue;
    const had = out.get(scene);
    if (!had || item.priceUsdc < had.priceUsdc) out.set(scene, item);
  }
  return out;
}
