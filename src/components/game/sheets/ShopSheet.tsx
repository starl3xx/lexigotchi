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
import { useShopRegistry, useShopScenes, useWardrobe } from "../useShop";
import { SceneThumb } from "../../scenes/SceneFrame";
import { sceneOfItem, sceneSale } from "@/lib/shop/scenes";
import { isCaseItem } from "@/lib/shop/cases";
import { CaseThumb } from "../../cards/CardCase";
import { erc20Abi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { availability, shopCards, usdcLabel, type Availability, type ShopCard } from "@/lib/shop/rules";

const STATUS: Record<Exclude<Availability, "on_sale">, string> = {
  not_yet: "Not on sale yet",
  ended: "No longer on sale",
  sold_out: "Sold out",
  inactive: "Not on sale",
};

export function ShopSheet() {
  const g = useGame();
  const { address } = useAccount();
  const testnet = NETWORK.isTestnet;
  const [buying, setBuying] = useState<number | null>(null);

  const shopQ = useShopRegistry();
  const wardrobeQ = useWardrobe();
  const scenes = useShopScenes();
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
        ) : !shopQ.data || !shopQ.data.metaKnown ? (
          // No answer, or one that couldn't say what the items are: listing them then would show a
          // real item as the test network's placeholder, and sell a scene to someone who has it.
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
              const scene = card.kind === "item" ? sceneOfItem(card.meta) : null;
              const isCase = card.kind === "item" && isCaseItem(card.meta);
              // A scene is bought once: a second one gets the player nothing. So it is sold only on
              // a positive "you don't have it" (lib/shop/scenes, sceneSale), from the wardrobe AND
              // from every item that sells this scene, not this item alone.
              const sale = scene ? sceneSale({ known: scenes.known, bought: scenes.bought.has(scene), checking: wardrobeQ.isLoading || shopQ.isLoading }) : "sell";
              return (
                <li key={card.item.id} className="cel-sm rounded-2xl bg-card p-3">
                  {/* a scene shows what it is: its card, with no word on it */}
                  {scene && (
                    <div className="card-corner mb-2 overflow-hidden border-2 border-ink">
                      <SceneThumb scene={scene} />
                    </div>
                  )}
                  {/* a case shows what it is too: empty, around a card with no word on it */}
                  {isCase && (
                    <div className="mx-auto mb-2 w-4/5">
                      <CaseThumb>
                        <SceneThumb scene="stock" tier="Rare" />
                      </CaseThumb>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display font-extrabold">{name}</div>
                      <div className="text-xs text-ink/60">
                        {card.kind === "placeholder"
                          ? "A placeholder on the test network. It does nothing; it’s here so you can try paying."
                          : scene
                            ? "A scene for your words’ cards. Pick it for a word with the palette button under its card."
                            : isCase
                              ? "A clear case for one word’s card, with a label of its own. Put a word in it with the Case button under its card."
                              : card.meta.kind === "scene"
                                ? "A scene"
                                : "A costume"}
                      </div>
                      {(owned > 0 || sale === "have") && (
                        <div className="mt-1 text-xs font-bold text-teal-ink">
                          {owned > 1 ? `You have ${owned}` : "You have it"}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-sm font-bold">{usdcLabel(card.item.priceUsdc, testnet)}</div>
                  </div>
                  {sale === "have" ? null : sale !== "sell" ? (
                    <div className="mt-2 text-center text-xs font-bold text-ink/55">
                      {sale === "checking" ? "Checking what you have…" : "Couldn’t check what you have. Close the Shop and try again."}
                    </div>
                  ) : status === "on_sale" ? (
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
