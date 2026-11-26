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
 * What the scene picker does with one Shop scene, for one player:
 * - "pick": it is theirs, so it is picked like any scene;
 * - "buy": they don't have it (a positive answer) and it can be bought now, so its tile shows the
 *   price and opens the Shop;
 * - null: it isn't listed.
 * While what they have isn't known (`known` false: the wardrobe is loading, a read failed), a scene
 * is never offered for sale: they may own it, and paying twice for a scene gets them nothing. The
 * one their word is showing then (lib/scenes, sceneShows) stays in the list, as picked.
 */
export function shopSceneOffer(a: { bought: boolean; known: boolean; onSale: boolean; showing: boolean }): "pick" | "buy" | null {
  if (a.bought) return "pick";
  if (!a.known) return a.showing ? "pick" : null;
  return a.onSale ? "buy" : null;
}

/**
 * Whether the Shop sells a scene to one player now:
 * - "have": their profile has it. A scene is bought once (a second purchase gets them nothing),
 *   so there is no Buy;
 * - "sell": a positive answer that they don't have it;
 * - "checking": what they have is still being read;
 * - "unknown": it couldn't be read. No Buy either: selling a scene to someone who may own it is
 *   the mistake to avoid, and a purchase couldn't be shown to them anyway.
 */
export function sceneSale(a: { known: boolean; bought: boolean; checking: boolean }): "have" | "sell" | "checking" | "unknown" {
  if (a.bought) return "have";
  if (a.known) return "sell";
  return a.checking ? "checking" : "unknown";
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
