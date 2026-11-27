"use client";
/**
 * The Shop (decisions.md #22, #55), behind SHOP_ENABLED: a screen of its own, with the registry's
 * items in their categories, what the player already has, and Buy. It was a sheet (a popup) until
 * the owner asked for a tab: "we'll eventually add more things and categories (card faces and
 * accessories for now)".
 *
 * - **Categories** (lib/shop/rules, `byCategory`): Card faces (kind "scene" in the table) and
 *   Accessories (a case now, a costume later), behind one switch, as the Market's parts are. A link
 *   lands on the category it names: `nav("shop", "faces")` from the face picker,
 *   `nav("shop", "accessories")` from an opened word's Case button.
 * - **An item is real once the owner lists it** (the admin's `addItem`, then its row in
 *   `shop_items`). The first is the Outer Space face, on Base Sepolia since 2026-11-27. On a test
 *   network an item with no row is a plain "Test item" card, kept apart from the categories under
 *   "Try paying": it is nothing a card wears.
 * - **A limited edition** (an item with a supply limit) says how many were made and how many are
 *   left (lib/shop/rules, `edition`). The contract holds the limit.
 * - **Never sold on a guess** (decisions.md #41, from Bugbot on #235): with no answer, or one that
 *   couldn't say what the items are (`metaKnown` false), nothing is listed; a face is offered only
 *   on a positive "you don't have it" (lib/shop/scenes, `sceneSale`).
 * - **Anyone can look.** The screen shows with no wallet, as the sheet did; Buy then leads to
 *   Today, where a wallet connects.
 *
 * Paying: 80% of the price goes to the studio and 20% buys $WORD for the Rewards Pool, in the same
 * transaction. Test USDC never shows as dollars. What is bought stays with the buyer's profile.
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useEffect, useState } from "react";
import { Button, Segmented } from "../primitives";
import { CircleNotch, Plus, ShoppingBag } from "../ui/icons";
import { useGame } from "../state";
import { useShopRegistry, useShopScenes, useWardrobe } from "../useShop";
import { SceneThumb } from "../../scenes/SceneFrame";
import { sceneOfItem, sceneSale } from "@/lib/shop/scenes";
import { isCaseItem } from "@/lib/shop/cases";
import { shopEnabled } from "@/lib/shop/config";
import { CaseThumb } from "../../cards/CardCase";
import { erc20Abi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import {
  CATEGORY_NAME,
  SHOP_CATEGORIES,
  availability,
  byCategory,
  edition,
  editionLine,
  isShopCategory,
  shopCards,
  usdcLabel,
  type Availability,
  type ShopCard,
  type ShopCategory,
} from "@/lib/shop/rules";

const STATUS: Record<Exclude<Availability, "on_sale">, string> = {
  not_yet: "Not on sale yet",
  ended: "No longer on sale",
  sold_out: "Sold out",
  inactive: "Not on sale",
};

/** What a category says when it holds nothing. Plain: it promises no item and no date. */
const EMPTY: Record<ShopCategory, string> = {
  faces: "No card faces in the Shop right now.",
  accessories: "No accessories in the Shop yet.",
};

export function ShopScreen() {
  const g = useGame();
  const { state } = g;
  const { address } = useAccount();
  const testnet = NETWORK.isTestnet;
  const [buying, setBuying] = useState<number | null>(null);
  const [tab, setTab] = useState<ShopCategory>(isShopCategory(state.section) ? state.section : "faces");

  // A link lands on the category it names (state.tsx, ViewSection). Keyed on the navigation as well
  // as the section, so the same link followed again lands again (as the Market's parts do).
  const { section, navSeq } = state;
  useEffect(() => {
    if (isShopCategory(section)) setTab(section);
  }, [section, navSeq]);

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

  // The rail and More offer the Shop only where it is open; a stale view (the switch went off, or
  // the practice game, which has no chain) says so and sells nothing.
  if (!state.chainBacked || !shopEnabled()) {
    return (
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-extrabold md:hidden">Shop</h1>
        <p className="text-sm text-ink/60">The Shop isn’t open here.</p>
      </div>
    );
  }

  const shop = shopQ.data;
  const paused = shop?.paused === true;
  const items = shop?.items ?? [];
  const meta = new Map(items.map((it) => [it.id, it.meta]));
  const cards = shopCards(items, (id) => meta.get(id) ?? null, testnet);
  const { categories, placeholders } = byCategory(cards);
  const now = Math.floor(Date.now() / 1000);
  const balance = balanceQ.data;
  const cheapest = cards
    .filter((c) => availability(c.item, now) === "on_sale")
    .reduce<bigint | null>((m, c) => (m === null || c.item.priceUsdc < m ? c.item.priceUsdc : m), null);
  const tooLow = balance !== undefined && cheapest !== null && balance < cheapest;
  const poolPct = Math.round((10_000 - (shop?.revenueBps ?? 8_000)) / 100);
  // No answer, or one that couldn't say what the items are: listing them then would show a real
  // item as the test network's placeholder, and sell a face to someone who has it.
  const known = !!shop && shop.metaKnown;

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

  const itemCard = (card: ShopCard) => {
    const status = availability(card.item, now);
    const owned = wardrobeQ.data?.get(card.item.id) ?? 0;
    const short = balance !== undefined && balance < card.item.priceUsdc;
    const name = card.kind === "item" ? card.meta.name : card.name;
    const scene = card.kind === "item" ? sceneOfItem(card.meta) : null;
    const isCase = card.kind === "item" && isCaseItem(card.meta);
    const limited = edition(card.item);
    // A face is bought once: a second one gets the player nothing. So it is sold only on a
    // positive "you don't have it" (lib/shop/scenes, sceneSale), from the wardrobe AND from every
    // item that sells this face, not this item alone.
    const sale = scene ? sceneSale({ known: scenes.known, bought: scenes.bought.has(scene), checking: wardrobeQ.isLoading || shopQ.isLoading }) : "sell";
    return (
      <li key={card.item.id} className="cel-sm flex flex-col rounded-2xl bg-card p-3">
        {/* a face shows what it is: the front of a card, with no word on it */}
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
        {/* The name and what it costs share a line; the words about it take the card's whole width
            under them (beside the price, a narrow card squeezed them into a column of two words). */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 font-display font-extrabold">{name}</div>
          <div className="shrink-0 text-right text-sm font-bold">{usdcLabel(card.item.priceUsdc, testnet)}</div>
        </div>
        <div className="mt-0.5 text-xs text-ink/60">
          {card.kind === "placeholder"
            ? "A placeholder on the test network. It does nothing; it’s here so you can try paying."
            : scene
              ? "A card face: the picture behind your word, on the front of its card. Buy it once, then pick it for any of your words with the palette button under a card."
              : isCase
                ? "A clear case for one word’s card, with a label of its own. Put a word in it with the Case button under its card."
                : card.meta.kind === "scene"
                  ? "A card face"
                  : "A costume"}
        </div>
        {limited && <div className="mt-1 text-xs font-bold text-ink/75">{editionLine(limited)}</div>}
        {(owned > 0 || sale === "have") && (
          <div className="mt-1 text-xs font-bold text-teal-ink">{owned > 1 ? `You have ${owned}` : "You have it"}</div>
        )}
        {/* the button sits at the foot of its card, so a row of cards lines its buttons up; a face
            the player has shows no button, and no empty foot either */}
        <div className={sale === "have" ? "hidden" : "mt-auto pt-2"}>
          {sale === "have" ? null : sale !== "sell" ? (
            <div className="text-center text-xs font-bold text-ink/55">
              {sale === "checking" ? "Checking what you have…" : "Couldn’t check what you have. Leave the Shop and come back."}
            </div>
          ) : status !== "on_sale" ? (
            <div className="text-center text-xs font-bold text-ink/55">{STATUS[status]}</div>
          ) : !address ? (
            <Button full size="sm" onClick={() => g.nav("home")}>
              Connect a wallet to buy
            </Button>
          ) : (
            <Button full size="sm" disabled={buying !== null || short || paused} onClick={() => void buy(card)}>
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
          )}
        </div>
      </li>
    );
  };

  const shown = categories[tab];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold md:hidden">Shop</h1>
        <p className="text-sm text-ink/60">Card faces and accessories for your words’ cards. What you buy stays with you, never with a word.</p>
      </div>

      {address && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-sm">
          <span className="text-ink/70">{testnet ? "Your test USDC" : "Your USDC"}</span>
          <span className="flex items-center gap-2">
            <span className="font-bold">{balance === undefined ? "–" : usdcLabel(balance, testnet)}</span>
            {testnet && tooLow && (
              <Button variant="teal" size="sm" onClick={() => void getUsdc()}>
                <Plus weight="bold" /> Get test USDC
              </Button>
            )}
          </span>
        </div>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={SHOP_CATEGORIES.map((c) => ({
          value: c,
          label: known && categories[c].length > 0 ? `${CATEGORY_NAME[c]} ${categories[c].length}` : CATEGORY_NAME[c],
        }))}
      />

      {shopQ.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink/60">
          <CircleNotch className="animate-spin" /> Opening the Shop…
        </div>
      ) : !known ? (
        <p className="py-6 text-center text-sm text-ink/60">The Shop didn’t load. Leave it and come back.</p>
      ) : (
        <section data-section={tab} aria-label={CATEGORY_NAME[tab]}>
          {shown.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-ink/25 p-6 text-center">
              <ShoppingBag size={32} weight="bold" className="mx-auto text-ink/40" />
              <p className="mt-2 text-sm text-ink/60">{EMPTY[tab]}</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map(itemCard)}</ul>
          )}
        </section>
      )}

      {/* The test network's placeholder: in no category, because it is nothing a card wears. */}
      {known && placeholders.length > 0 && (
        <section aria-label="Try paying" className="border-t-2 border-dashed border-ink/15 pt-3">
          <h2 className="font-display text-sm font-extrabold">Try paying</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{placeholders.map(itemCard)}</ul>
        </section>
      )}

      <p className="border-t-2 border-ink/15 pt-3 text-xs text-ink/55">
        Paid in {testnet ? "test USDC" : "USDC"} on {NETWORK.name}. {100 - poolPct}% goes to the studio, and {poolPct}% buys $WORD for the
        Rewards Pool in the same transaction. What you buy stays with your profile: it never goes with a word you sell, dissolve, or move.
      </p>
    </div>
  );
}
