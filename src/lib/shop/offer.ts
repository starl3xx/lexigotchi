/**
 * What the Shop offers ONE player for ONE item, right now (decisions.md #55). Pure, so the rule is
 * tested, and one rule for every place that shows a Buy: an item's card on the Shop's screen and
 * the item's own view (sheets/ShopItemSheet). Two copies of this ladder would one day disagree,
 * and the copy that was wrong would sell a face to someone who has it.
 *
 * The order is the order of the reasons NOT to sell, the strongest first:
 * 1. **They have it** (a face is bought once): nothing to buy, whatever the item's sale says.
 * 2. **What they have isn't known** (still reading, or the read failed): no Buy. Never sold on a
 *    guess (decisions.md #41, lib/shop/scenes `sceneSale`).
 * 3. **The item isn't on sale** (not yet, ended, sold out, switched off): its status says which.
 * 4. **No wallet**: the Shop is a public screen, so a visitor is sent to connect.
 * 5. **Buy**, held back while the Shop is paused or the wallet holds too little. Paused comes
 *    first: more USDC wouldn't help.
 */
import { availability, type Availability, type RegistryItem } from "./rules";
import type { sceneSale } from "./scenes";

/** Whether the Shop sells this player the thing at all (lib/shop/scenes, `sceneSale`). An item that
 *  isn't a card face is always "sell": it can be bought more than once. */
export type ItemSale = ReturnType<typeof sceneSale>;

export type BuyOffer =
  | { kind: "have" }
  | { kind: "wait"; why: "checking" | "unknown" }
  | { kind: "off"; status: Exclude<Availability, "on_sale"> }
  | { kind: "connect" }
  | { kind: "buy"; blocked: "paused" | "short" | null };

export function buyOffer(a: {
  sale: ItemSale;
  status: Availability;
  /** A wallet is connected. */
  wallet: boolean;
  /** The Shop is paused (`Shop.paused`). */
  paused: boolean;
  /** The wallet's USDC is known and is less than the price. Unknown is not short. */
  short: boolean;
}): BuyOffer {
  if (a.sale === "have") return { kind: "have" };
  if (a.sale !== "sell") return { kind: "wait", why: a.sale };
  if (a.status !== "on_sale") return { kind: "off", status: a.status };
  if (!a.wallet) return { kind: "connect" };
  return { kind: "buy", blocked: a.paused ? "paused" : a.short ? "short" : null };
}

/**
 * The end of an item's sale, for its view to say: `until` for an item on sale now that has an end,
 * `from` for one whose sale hasn't started. Seconds, as the registry holds them. Null when there is
 * nothing to say: an item with no end says nothing (the owner can set one later with `updateItem`,
 * so "always on sale" would be a promise), and one that ended or sold out has its status instead.
 */
export function saleWindow(item: Pick<RegistryItem, "start" | "end" | "maxSupply" | "sold" | "active">, nowSec: number): { from: number } | { until: number } | null {
  const status = availability({ id: 0, priceUsdc: 0n, ...item }, nowSec);
  if (status === "not_yet") return { from: item.start };
  if (status === "on_sale" && item.end !== 0) return { until: item.end };
  return null;
}
