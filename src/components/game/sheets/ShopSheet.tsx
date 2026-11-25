"use client";
/**
 * The Shop (decisions.md #22), behind SHOP_ENABLED: the registry's items that the app can show, what
 * the player already has, and Buy. Infrastructure only: real items come later, through the admin and
 * the `shop_items` table, so with none it shows a plain empty state. On a test network an item with
 * no metadata is a plain "Test item" card (lib/shop/rules.ts), and Get test USDC sits here too when
 * a tester's balance is too low for an item.
 *
 * Paying: 80% of the price goes to the studio and 20% buys $WORD for the Rewards Pool, in the same
 * transaction. Test USDC never shows as dollars.
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useState } from "react";
import { Button, Sheet } from "../primitives";
import { CircleNotch, Plus, ShoppingBag } from "../ui/icons";
import { useGame } from "../state";
import { usePlayerWallets } from "../usePlayerWallets";
import { erc20Abi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import {
  availability,
  shopCards,
  usdcLabel,
  type Availability,
  type ItemMeta,
  type RegistryItem,
  type ShopCard,
} from "@/lib/shop/rules";

interface ShopJson {
  ok: boolean;
  revenueBps?: number;
  paused?: boolean;
  items?: (Omit<RegistryItem, "priceUsdc"> & { priceUsdc: string; meta: ItemMeta | null })[];
}

const STATUS: Record<Exclude<Availability, "on_sale">, string> = {
  not_yet: "Not on sale yet",
  ended: "No longer on sale",
  sold_out: "Sold out",
  inactive: "Not on sale",
};

export function ShopSheet() {
  const g = useGame();
  const { address } = useAccount();
  const wallets = usePlayerWallets();
  const testnet = NETWORK.isTestnet;
  const [buying, setBuying] = useState<number | null>(null);

  const shopQ = useQuery({
    queryKey: ["shop", "registry"],
    staleTime: 15_000,
    queryFn: async () => {
      const r = await fetch("/api/shop");
      const d = (await r.json().catch(() => null)) as ShopJson | null;
      if (!r.ok || !d?.ok) return null;
      return {
        paused: d.paused === true,
        revenueBps: d.revenueBps ?? 8_000,
        items: (d.items ?? []).map((it) => ({ ...it, priceUsdc: BigInt(it.priceUsdc) })),
      };
    },
  });
  const wardrobeQ = useQuery({
    queryKey: ["shop", "wardrobe", wallets.join(",")],
    enabled: wallets.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const r = await fetch(`/api/shop/wardrobe?wallets=${wallets.join(",")}`);
      const d = (await r.json().catch(() => null)) as { ok: boolean; items?: { itemId: number; count: number }[] } | null;
      return new Map((d?.items ?? []).map((i) => [i.itemId, i.count]));
    },
  });
  const usdc = usdcAddress();
  const balanceQ = useQuery({
    queryKey: ["shop", "usdc", address],
    enabled: !!address && !!usdc,
    staleTime: 10_000,
    queryFn: async () =>
      (await getPublicClient().readContract({ address: usdc!, abi: erc20Abi, functionName: "balanceOf", args: [address!] })) as bigint,
  });

  const shop = shopQ.data;
  const paused = shop?.paused === true;
  const items = shop?.items ?? [];
  const meta = new Map(items.map((it) => [it.id, it.meta]));
  const cards = shopCards(items, (id) => meta.get(id) ?? null, testnet);
  const now = Math.floor(Date.now() / 1000);
  const balance = balanceQ.data;
  const cheapest = cards
    .filter((c) => availability(c.item, now) === "on_sale")
    .reduce<bigint | null>((m, c) => (m === null || c.item.priceUsdc < m ? c.item.priceUsdc : m), null);
  const tooLow = balance !== undefined && cheapest !== null && balance < cheapest;
  const poolPct = Math.round((10_000 - (shopQ.data?.revenueBps ?? 8_000)) / 100);

  const buy = async (card: ShopCard) => {
    setBuying(card.item.id);
    try {
      if (await g.buyShopItem({ id: card.item.id, priceUsdc: card.item.priceUsdc })) {
        void wardrobeQ.refetch();
        void shopQ.refetch();
      }
      void balanceQ.refetch();
    } finally {
      setBuying(null);
    }
  };
  const getUsdc = async () => {
    if (await g.getTestUsdc()) void balanceQ.refetch();
  };

  return (
    <Sheet open onClose={g.closeSheet} title="Shop">
      <div className="space-y-3 pb-2">
        <div className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm">
          <span className="text-ink/70">{testnet ? "Your test USDC" : "Your USDC"}</span>
          <span className="font-bold">
            {balance === undefined ? "–" : usdcLabel(balance, testnet)}
          </span>
        </div>

        {shopQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink/60">
            <CircleNotch className="animate-spin" /> Opening the Shop…
          </div>
        ) : !shopQ.data ? (
          <p className="py-6 text-center text-sm text-ink/60">The Shop didn’t load. Close it and try again.</p>
        ) : cards.length === 0 ? (
          <div className="cel rounded-2xl bg-card p-5 text-center">
            <ShoppingBag size={32} weight="bold" className="mx-auto text-ink/40" />
            <p className="mt-2 font-display font-extrabold">Nothing in the Shop yet</p>
            <p className="mt-1 text-xs text-ink/60">When there is, it shows up here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cards.map((card) => {
              const status = availability(card.item, now);
              const owned = wardrobeQ.data?.get(card.item.id) ?? 0;
              const short = balance !== undefined && balance < card.item.priceUsdc;
              const name = card.kind === "item" ? card.meta.name : card.name;
              return (
                <li key={card.item.id} className="cel-sm rounded-2xl bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display font-extrabold">{name}</div>
                      <div className="text-xs text-ink/60">
                        {card.kind === "placeholder"
                          ? "A placeholder on the test network. It does nothing; it’s here so you can try paying."
                          : card.meta.kind === "scene"
                            ? "A scene"
                            : "A costume"}
                      </div>
                      {owned > 0 && (
                        <div className="mt-1 text-xs font-bold text-teal-ink">
                          {owned === 1 ? "You have it" : `You have ${owned}`}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-sm font-bold">{usdcLabel(card.item.priceUsdc, testnet)}</div>
                  </div>
                  {status === "on_sale" ? (
                    <Button
                      full
                      size="sm"
                      className="mt-2"
                      disabled={buying !== null || short || paused}
                      onClick={() => void buy(card)}
                    >
                      {buying === card.item.id ? (
                        <>
                          <CircleNotch className="animate-spin" /> Buying…
                        </>
                      ) : paused ? (
                        "The Shop is paused"
                      ) : short ? (
                        testnet ? "Not enough test USDC" : "Not enough USDC"
                      ) : (
                        `Buy for ${usdcLabel(card.item.priceUsdc, testnet)}`
                      )}
                    </Button>
                  ) : (
                    <div className="mt-2 text-center text-xs font-bold text-ink/55">{STATUS[status]}</div>
                  )}
                  {card.item.maxSupply > 0 && (
                    <div className="mt-1 text-center text-xs text-ink/55">
                      {card.item.sold} of {card.item.maxSupply} sold
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {testnet && tooLow && (
          <div className="rounded-xl bg-card p-3 text-center">
            <p className="text-xs text-ink/65">You need more test USDC for this.</p>
            <Button variant="teal" size="sm" className="mt-2" onClick={() => void getUsdc()}>
              <Plus weight="bold" /> Get test USDC
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-ink/55">
          Paid in {testnet ? "test USDC" : "USDC"} on {NETWORK.name}. {100 - poolPct}% goes to the studio, and {poolPct}% buys
          $WORD for the Rewards Pool in the same transaction. Items stay with your profile.
        </p>
      </div>
    </Sheet>
  );
}
