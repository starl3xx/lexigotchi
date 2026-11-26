"use client";
/**
 * What the Shop sells and what the player has bought (decisions.md #22, #41), read once for the
 * page: the Shop sheet, the scene picker, and every word's scene share these two reads.
 *
 * Both are silent where there is no Shop to ask (the switch is off, or the practice game, which
 * has no chain): their `data` stays undefined, and a caller must treat that as "not known", never
 * as "nothing bought". A wardrobe that answers with an error is `null`, for the same reason.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { shopEnabled } from "@/lib/shop/config";
import type { ItemMeta, RegistryItem } from "@/lib/shop/rules";
import { boughtScenes, scenesOnSale } from "@/lib/shop/scenes";
import type { SceneId } from "@/lib/scenes";
import { useGame } from "./state";
import { usePlayerWallets } from "./usePlayerWallets";

interface ShopJson {
  ok: boolean;
  revenueBps?: number;
  paused?: boolean;
  metaKnown?: boolean;
  items?: (Omit<RegistryItem, "priceUsdc"> & { priceUsdc: string; meta: ItemMeta | null })[];
}
export type ShopItem = RegistryItem & { meta: ItemMeta | null };
export interface ShopRegistry {
  paused: boolean;
  revenueBps: number;
  /** False when the server couldn't read what the items are (every `meta` is null then): what an
   *  item is, and so what the player owns, is not known. */
  metaKnown: boolean;
  items: ShopItem[];
}

/** The Shop's items, with what each is. Null when the Shop didn't answer. */
export function useShopRegistry() {
  const { state } = useGame();
  return useQuery({
    queryKey: ["shop", "registry"],
    enabled: state.chainBacked && shopEnabled(),
    staleTime: 15_000,
    queryFn: async (): Promise<ShopRegistry | null> => {
      const r = await fetch("/api/shop");
      const d = (await r.json().catch(() => null)) as ShopJson | null;
      if (!r.ok || !d?.ok) return null;
      return {
        paused: d.paused === true,
        revenueBps: d.revenueBps ?? 8_000,
        metaKnown: d.metaKnown !== false,
        items: (d.items ?? []).map((it) => ({ ...it, priceUsdc: BigInt(it.priceUsdc) })),
      };
    },
  });
}

/** What the player's profile has bought: item id → how many. Null when the wardrobe didn't answer. */
export function useWardrobe() {
  const { state } = useGame();
  const wallets = usePlayerWallets();
  return useQuery({
    queryKey: ["shop", "wardrobe", wallets.join(",")],
    enabled: state.chainBacked && shopEnabled() && wallets.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Map<number, number> | null> => {
      const r = await fetch(`/api/shop/wardrobe?wallets=${wallets.join(",")}`);
      const d = (await r.json().catch(() => null)) as { ok: boolean; items?: { itemId: number; count: number }[] } | null;
      if (!r.ok || !d?.ok) return null;
      return new Map((d.items ?? []).map((i) => [i.itemId, i.count]));
    },
  });
}

const NO_SCENES: ReadonlySet<SceneId> = new Set();
const NOTHING_BOUGHT: ReadonlyMap<number, number> = new Map();
const NONE_ON_SALE: ReadonlyMap<SceneId, ShopItem> = new Map();

/**
 * The Shop's scenes, for this player (lib/shop/scenes says what grants one):
 * - `bought`: the Shop scenes their profile has, as far as a positive answer says.
 * - `known`: whether that answer is in. While it isn't (still loading, a failed read, the Shop
 *   switched off), a word's saved pick of a Shop scene keeps showing: taking a paid scene off a
 *   buyer's card because a read failed would be the worse mistake (the 3-word unlock treats
 *   "unknown" the same way). The picker offers a Shop scene only on a positive answer, and offers
 *   one FOR SALE only when `known` (lib/shop/scenes, shopSceneOffer): `onSale` can be in before
 *   the wardrobe is, and a scene the player owns must never be sold to them again.
 * - `onSale`: the Shop scenes that can be bought now, each with its item.
 * The practice game has no Shop: nothing bought, nothing on sale, and that is known.
 */
export function useShopScenes(): { bought: ReadonlySet<SceneId>; known: boolean; onSale: ReadonlyMap<SceneId, ShopItem> } {
  const { state } = useGame();
  const registry = useShopRegistry().data;
  const read = useWardrobe().data;
  // With no wallet there is no wardrobe to read, and nothing bought: that is an answer.
  const noWallet = usePlayerWallets().length === 0;
  const wardrobe = noWallet ? NOTHING_BOUGHT : read;
  return useMemo(() => {
    if (!state.chainBacked) return { bought: NO_SCENES, known: true, onSale: NONE_ON_SALE };
    // No registry, or one that couldn't say what its items are: nothing is known, and nothing is
    // offered (an item whose row couldn't be read looks like "not a scene").
    if (!registry || !registry.metaKnown) return { bought: NO_SCENES, known: false, onSale: NONE_ON_SALE };
    const metaOf = (id: number) => registry.items.find((it) => it.id === id)?.meta ?? null;
    const onSale = registry.paused ? NONE_ON_SALE : (scenesOnSale(registry.items, metaOf, Math.floor(Date.now() / 1000)) as Map<SceneId, ShopItem>);
    if (!wardrobe) return { bought: NO_SCENES, known: false, onSale };
    return { bought: boughtScenes(wardrobe, metaOf), known: true, onSale };
  }, [state.chainBacked, registry, wardrobe]);
}
