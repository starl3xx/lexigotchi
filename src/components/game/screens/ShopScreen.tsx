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
 * - **A card opens the item's own view** (sheets/ShopItemSheet; the owner, the same day: "I should
 *   be able to click items and see more info about them, see them at higher size, etc"). The card's
 *   picture and words are one button, stretched over the whole card; Buy stays a button of its
 *   own on top of it. What the card says and whether it sells are the view's own answers
 *   (game/useShop `useShopView`, shop/ShopBuy), so the two can't disagree. The test network's
 *   placeholder opens nothing: there is nothing more to see.
 *
 * Paying: 80% of the price goes to the studio and 20% buys $WORD for the Rewards Pool, in the same
 * transaction. Test USDC never shows as dollars. What is bought stays with the buyer's profile.
 */
import { useEffect, useState } from "react";
import { Button, Segmented } from "../primitives";
import { CircleNotch, Plus, ShoppingBag } from "../ui/icons";
import { useGame } from "../state";
import { useShopView } from "../useShop";
import { ShopBuy, itemWords } from "../shop/ShopBuy";
import { SceneThumb } from "../../scenes/SceneFrame";
import { shopEnabled } from "@/lib/shop/config";
import { offerIsButton } from "@/lib/shop/offer";
import { CaseThumb } from "../../cards/CardCase";
import { NETWORK } from "@/lib/onchain/network";
import {
  CATEGORY_NAME,
  SHOP_CATEGORIES,
  availability,
  byCategory,
  editionLine,
  isShopCategory,
  usdcLabel,
  type ShopCard,
  type ShopCategory,
} from "@/lib/shop/rules";

/** What a category says when it holds nothing. Plain: it promises no item and no date. */
const EMPTY: Record<ShopCategory, string> = {
  faces: "No card faces in the Shop right now.",
  accessories: "No accessories in the Shop yet.",
};

export function ShopScreen() {
  const g = useGame();
  const { state } = g;
  const testnet = NETWORK.isTestnet;
  const [tab, setTab] = useState<ShopCategory>(isShopCategory(state.section) ? state.section : "faces");

  // A link lands on the category it names (state.tsx, ViewSection). Keyed on the navigation as well
  // as the section, so the same link followed again lands again (as the Market's parts do).
  const { section, navSeq } = state;
  useEffect(() => {
    if (isShopCategory(section)) setTab(section);
  }, [section, navSeq]);

  const v = useShopView();

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

  const { cards, known, balance, poolPct } = v;
  const { categories, placeholders } = byCategory(cards);
  const cheapest = cards
    .filter((c) => availability(c.item, v.now) === "on_sale")
    .reduce<bigint | null>((m, c) => (m === null || c.item.priceUsdc < m ? c.item.priceUsdc : m), null);
  const tooLow = balance !== undefined && cheapest !== null && balance < cheapest;

  const getUsdc = async () => {
    if (await g.getTestUsdc()) void v.refetchBalance();
  };

  const itemCard = (card: ShopCard) => {
    const about = v.about(card);
    const { name, scene, isCase, limited } = about;
    // What the card shows of the thing: its picture, its name and price, and the words about it.
    const look = (
      <>
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
        <div className="mt-0.5 text-xs text-ink/60">{itemWords(card, about)}</div>
      </>
    );
    const opens = card.kind === "item";
    return (
      // An item's card lifts and presses as one thing (`press`), because one tap anywhere on it
      // opens the item: the button below is stretched over the card (its ::after), and Buy sits
      // above that, a button of its own.
      // `isolate`: Buy's own layer stays inside its card, so it can never paint over the header
      // or the phone's bottom bar as the list scrolls under them.
      <li key={card.item.id} className={`cel-sm isolate flex flex-col rounded-2xl bg-card p-3 ${opens ? "press" : ""}`}>
        {opens ? (
          <button
            type="button"
            aria-label={`${name}: see it larger, and more about it`}
            onClick={() => g.openSheet({ kind: "shopItem", id: card.item.id })}
            className="block w-full rounded-xl text-left after:absolute after:inset-0 after:rounded-2xl after:content-['']"
          >
            {look}
          </button>
        ) : (
          look
        )}
        {limited && <div className="mt-1 text-xs font-bold text-ink/75">{editionLine(limited)}</div>}
        {about.have && <div className="mt-1 text-xs font-bold text-teal-ink">{about.owned > 1 ? `You have ${about.owned}` : "You have it"}</div>}
        {/* the button sits at the foot of its card, so a row of cards lines its buttons up; a face
            the player has shows no button, and no empty foot either */}
        {/* Only a BUTTON is lifted above the card's own open button. A line that says why there is no
            Buy ("Sold out", "Not on sale yet", "Checking what you have…") stays under it, with the
            gap above the foot: a tap there opens the item, like a tap anywhere else on the card.
            Lifting the whole foot made those lines dead to a tap (Bugbot on #316). */}
        {about.offer.kind !== "have" && (
          <div className="mt-auto pt-2">
            <div className={offerIsButton(about.offer) ? "relative z-10" : undefined}>
              <ShopBuy card={card} about={about} />
            </div>
          </div>
        )}
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

      {v.wallet && (
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

      {v.loading ? (
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
