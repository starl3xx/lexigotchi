"use client";
/**
 * What the Shop sells and what the player has bought (decisions.md #22, #41, #42), read once for
 * the page: the Shop's screen, the face picker, every word's face, and the cases share these reads.
 *
 * Both are silent where there is no Shop to ask (the switch is off, or the practice game, which
 * has no chain): their `data` stays undefined, and a caller must treat that as "not known", never
 * as "nothing bought". A wardrobe that answers with an error is `null`, for the same reason.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { erc20Abi } from "@/lib/onchain/abis";
import { shopAddress, usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { getPublicClient } from "@/lib/onchain/reads";
import { casesState, isCaseItem, type CasesState } from "@/lib/shop/cases";
import { shopEnabled } from "@/lib/shop/config";
import { SHOP_BUY_LABEL } from "@/lib/shop/buy";
import { buyOffer, type BuyOffer } from "@/lib/shop/offer";
import { availability, edition, shopCards, type Availability, type ItemMeta, type RegistryItem, type ShopCard } from "@/lib/shop/rules";
import { boughtScenes, sceneOfItem, sceneSale, scenesOnSale } from "@/lib/shop/scenes";
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

const NO_CASES: ReadonlyMap<string, number> = new Map();
/** The profile session's header (lib/profile/session.ts, a server module: named again here). */
const SESSION_HEADER = "x-lexigotchi-session";

export interface WordCases extends CasesState<ShopItem> {
  /** The words that show a case (`shown`, under the name a card asks by) and when each went in (ms). */
  cased: ReadonlyMap<string, number>;
  /** Put a word in a case, or take it out, under the profile session's token. */
  set: (word: string, on: boolean, token: string) => Promise<"ok" | "none_left" | "no_session" | "failed">;
}

/**
 * The player's cases (decisions.md #42; lib/shop/cases says what a case is, that one case holds
 * one word, and how the three reads here are put together: `casesState`).
 *
 * - **Which words are in a case is the server's answer** (`/api/cases`), and nothing here adds to
 *   it: the server is the one place that counts cases. It is read wherever this network has a
 *   Shop, even while the Shop is switched off: a buyer's words keep their cases.
 * - **A read that is missing is never read as zero.** While the list is loading or failed, no word
 *   shows a case and nothing is offered; while the count isn't known (the wardrobe, or a Shop that
 *   couldn't say what its items are), every listed word keeps its case and no word is offered one.
 * The practice game has no Shop: no cases, and that is known.
 */
export function useWordCases(): WordCases {
  const { state } = useGame();
  const wallets = usePlayerWallets();
  const qc = useQueryClient();
  const registry = useShopRegistry().data;
  const wardrobe = useWardrobe().data;
  const key = wallets.join(",");
  const list = useQuery({
    queryKey: ["shop", "cases", key],
    enabled: state.chainBacked && !!shopAddress() && wallets.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number> | null> => {
      const r = await fetch(`/api/cases?wallets=${key}`);
      const d = (await r.json().catch(() => null)) as { ok: boolean; cases?: { word: string; since: number }[] } | null;
      if (!r.ok || !d?.ok) return null;
      // a profile's cases repeat for each of its wallets named: one entry a word, the oldest
      const out = new Map<string, number>();
      for (const c of d.cases ?? []) out.set(c.word, Math.min(c.since, out.get(c.word) ?? Infinity));
      return out;
    },
  });
  const set = useCallback<WordCases["set"]>(
    async (word, on, token) => {
      const r = await fetch("/api/cases", {
        method: "PUT",
        headers: { "content-type": "application/json", [SESSION_HEADER]: token },
        body: JSON.stringify({ word, on }),
      }).catch(() => null);
      if (r?.status === 401) return "no_session";
      if (r?.status === 409) return "none_left";
      if (!r?.ok) return "failed";
      // show it at once, then read the server's own list again
      qc.setQueryData<Map<string, number> | null>(["shop", "cases", key], (had) => {
        const next = new Map(had ?? []);
        if (on) next.set(word, next.get(word) ?? Date.now());
        else next.delete(word);
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["shop", "cases"] });
      return "ok";
    },
    [qc, key],
  );

  const listed = list.data;
  return useMemo(() => {
    // The practice game: no cases, nothing to buy, and all of that known.
    const known = state.chainBacked
      ? casesState({ list: listed, shop: registry, wardrobe, nowSec: Math.floor(Date.now() / 1000) })
      : { held: NO_CASES, shown: NO_CASES, bought: 0, left: 0, onSale: null };
    return { ...known, cased: known.shown, set };
  }, [state.chainBacked, registry, wardrobe, listed, set]);
}

/** The connected wallet's USDC (6-decimal units): one read for the Shop's screen and an item's view. */
export function useUsdcBalance() {
  const { address } = useAccount();
  const usdc = usdcAddress();
  return useQuery({
    queryKey: ["shop", "usdc", address],
    enabled: !!address && !!usdc,
    staleTime: 10_000,
    queryFn: async () =>
      (await getPublicClient().readContract({ address: usdc!, abi: erc20Abi, functionName: "balanceOf", args: [address!] })) as bigint,
  });
}

const BUY_KEY = ["shop", "buy"] as const;

/**
 * Buy a thing from the Shop, from wherever it is shown. `buyingId` is the item being bought NOW,
 * known to every Buy on the page: an item's card and its own view both show one, the view is a
 * sheet that can be closed mid-purchase, and the card behind it must not offer a second Buy then.
 * (The action gate would refuse the second send; the button should not offer it.) What the Shop
 * and the player hold is read again when the purchase settles, even if its sheet has gone.
 *
 * **In flight means the action gate says so** (`g.busy`, lib/onchain/actionGate), never the
 * purchase's own promise alone. A wallet that never answers leaves that promise pending for
 * good; the player presses Hide on the status pill, which releases the gate, and Buy must be
 * live again then. Counting the pending promise by itself left every Buy disabled until a reload.
 * The promise only says WHICH item (the newest one started).
 */
export function useShopBuy(): { buyingId: number | null; buy: (item: { id: number; priceUsdc: bigint }) => Promise<boolean> } {
  const g = useGame();
  const qc = useQueryClient();
  const inFlight = useMutationState({
    filters: { mutationKey: BUY_KEY, status: "pending" },
    select: (m) => (m.state.variables as { id: number } | undefined)?.id ?? null,
  });
  const { mutateAsync } = useMutation({
    mutationKey: BUY_KEY,
    // A purchase runs AT THE TAP or not at all. By default a mutation waits while the browser is
    // offline and runs when the network returns: a tap made offline showed nothing, and seconds
    // after the network came back the wallet was asked to pay, with no new tap (seen in review).
    // "always" runs it at once, as the direct call did: offline, its first read fails and says so.
    networkMode: "always",
    retry: false,
    mutationFn: (item: { id: number; priceUsdc: bigint }) => g.buyShopItem(item),
    onSettled: (ok) => {
      if (ok) {
        void qc.invalidateQueries({ queryKey: ["shop", "wardrobe"] });
        void qc.invalidateQueries({ queryKey: ["shop", "registry"] });
      }
      void qc.invalidateQueries({ queryKey: ["shop", "usdc"] });
    },
  });
  const { toast } = g;
  // The purchase says for itself how it ended (a toast for each outcome it knows). What it can't
  // say is that it never got going: its first read threw (offline, or the RPC didn't answer).
  // That used to be silent: a tap on Buy with nothing after it.
  const buy = useCallback(
    (item: { id: number; priceUsdc: bigint }) =>
      mutateAsync(item).catch(() => {
        toast("Couldn’t reach the Shop. Check your connection and try again.", "bad");
        return false;
      }),
    [mutateAsync, toast],
  );
  const buying = g.busy?.label === SHOP_BUY_LABEL;
  const started = inFlight.filter((id): id is number => id !== null);
  return { buyingId: buying ? (started.at(-1) ?? null) : null, buy };
}

/** One shown item, as this player sees it: what it is, what they have, and what the Shop offers. */
export interface ItemAbout {
  name: string;
  status: Availability;
  /** How many of this item the profile's wardrobe holds, as far as it has answered. */
  owned: number;
  /** They have it: this item in their wardrobe, or (a card face) the face from any item. */
  have: boolean;
  /** The card face it is, or null. */
  scene: SceneId | null;
  isCase: boolean;
  limited: { made: number; left: number } | null;
  offer: BuyOffer;
}

/**
 * The Shop as this player sees it: the shown items, whether the Shop could say what they are, and
 * each item's `about`. One place for the Shop's screen and an item's view (sheets/ShopItemSheet),
 * so a card and the view it opens can never say different things about the same item.
 *
 * `known` is false with no answer, or one that couldn't say what the items are (`metaKnown`):
 * nothing is listed then. Listing would show a real item as the test network's placeholder, and
 * sell a face to someone who has it (decisions.md #41).
 */
export function useShopView() {
  const { address } = useAccount();
  const shopQ = useShopRegistry();
  const wardrobeQ = useWardrobe();
  const scenes = useShopScenes();
  const balanceQ = useUsdcBalance();
  const testnet = NETWORK.isTestnet;
  const shop = shopQ.data;
  const balance = balanceQ.data;
  const paused = shop?.paused === true;
  const now = Math.floor(Date.now() / 1000);
  const cards = useMemo(() => {
    const items = shop?.items ?? [];
    const meta = new Map(items.map((it) => [it.id, it.meta]));
    return shopCards(items, (id) => meta.get(id) ?? null, testnet);
  }, [shop, testnet]);
  const checking = wardrobeQ.isLoading || shopQ.isLoading;
  const wardrobe = wardrobeQ.data;

  const about = (card: ShopCard): ItemAbout => {
    const status = availability(card.item, now);
    const owned = wardrobe?.get(card.item.id) ?? 0;
    const scene = card.kind === "item" ? sceneOfItem(card.meta) : null;
    // A face is bought once: a second one gets the player nothing. So it is sold only on a
    // positive "you don't have it" (lib/shop/scenes, sceneSale), from the wardrobe AND from every
    // item that sells this face, not this item alone.
    const sale = scene ? sceneSale({ known: scenes.known, bought: scenes.bought.has(scene), checking }) : "sell";
    return {
      name: card.kind === "item" ? card.meta.name : card.name,
      status,
      owned,
      have: owned > 0 || sale === "have",
      scene,
      isCase: card.kind === "item" && isCaseItem(card.meta),
      limited: edition(card.item),
      offer: buyOffer({ sale, status, wallet: !!address, paused, short: balance !== undefined && balance < card.item.priceUsdc }),
    };
  };

  return {
    loading: shopQ.isLoading,
    known: !!shop && shop.metaKnown,
    paused,
    cards,
    about,
    now,
    /** The connected wallet's USDC; undefined with no wallet or before the read. */
    balance,
    refetchBalance: balanceQ.refetch,
    wallet: !!address,
    testnet,
    /** The share of a purchase that buys $WORD for the Rewards Pool, in percent. */
    poolPct: Math.round((10_000 - (shop?.revenueBps ?? 8_000)) / 100),
  };
}
