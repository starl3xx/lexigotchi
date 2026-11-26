/**
 * What a profile has bought in the Shop, on the server (decisions.md #41, #42): the Shop scenes its
 * wardrobe holds, and how many cases. `/api/scenes` asks before it saves a pick of a Shop scene, and
 * `/api/cases` before it puts a word in a case, so neither can be had without the purchase.
 *
 * Reads the wardrobe and what each item is (`shop_items`) whether or not the Shop's switch is on:
 * a purchase stays the buyer's after the Shop is hidden. No Shop on this network means nobody has
 * bought anything. A database error throws: the caller must not guess.
 */
import { NETWORK } from "@/lib/onchain/network";
import { shopAddress } from "@/lib/onchain/addresses";
import { itemMetadata, wardrobeOf } from "@/lib/db/shop";
import type { SceneId } from "@/lib/scenes";
import { casesBought } from "./cases";
import { boughtScenes } from "./scenes";

export async function boughtScenesOf(wallets: readonly string[]): Promise<Set<SceneId>> {
  const shop = shopAddress();
  if (!shop || wallets.length === 0) return new Set();
  const [owned, meta] = await Promise.all([wardrobeOf(NETWORK.id, shop, wallets), itemMetadata(NETWORK.id, shop)]);
  return boughtScenes(new Map(owned.map((o) => [o.itemId, o.count])), (id) => meta.get(id) ?? null);
}

/** How many cases these wallets' profile has bought (lib/shop/cases). Throws on a database error. */
export async function casesBoughtBy(wallets: readonly string[]): Promise<number> {
  const shop = shopAddress();
  if (!shop || wallets.length === 0) return 0;
  const [owned, meta] = await Promise.all([wardrobeOf(NETWORK.id, shop, wallets), itemMetadata(NETWORK.id, shop)]);
  return casesBought(new Map(owned.map((o) => [o.itemId, o.count])), (id) => meta.get(id) ?? null);
}
