/**
 * The Shop's rules (decisions.md #22), pure so they're tested: when the Shop shows at all, which
 * items it shows, and which can be bought right now.
 *
 * The registry onchain holds only prices, windows, and supply. What an item IS (its name, kind, and
 * art) lives in the `shop_items` table, which starts EMPTY: real items get a row when they're added.
 * An item with no row is not shown, with one exception: on a TEST network it shows as a plain
 * placeholder card called "Test item", so testers can exercise paying with the one placeholder item
 * on Base Sepolia. The exception is a rule about networks, never a name stored anywhere, so no
 * mainnet item can ever show as a test item.
 */

/**
 * The kinds a wardrobe can hold: a scene (lib/shop/scenes), a case for a word's card
 * (lib/shop/cases), and costumes, a slot for later.
 */
export const ITEM_KINDS = ["scene", "costume", "case"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function isItemKind(v: unknown): v is ItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}

/** One registry entry, as `Shop.item(id)` returns it (USDC in 6-decimal units, times in seconds). */
export interface RegistryItem {
  id: number;
  priceUsdc: bigint;
  start: number;
  end: number; // 0 = no end
  maxSupply: number; // 0 = unlimited
  sold: number;
  active: boolean;
}

/** What the database says an item is. */
export interface ItemMeta {
  name: string;
  kind: ItemKind;
  /** A reference to its art (a scene id, an asset path); null until it has art. */
  art: string | null;
}

export type ShopCard =
  | { kind: "item"; item: RegistryItem; meta: ItemMeta }
  /** Testnet only: an item with no metadata, shown plainly so testers can pay for it. */
  | { kind: "placeholder"; item: RegistryItem; name: "Test item" };

/** What one tap of the test USDC faucet gives (MockUSDC.FAUCET_AMOUNT): 25 test USDC. */
export const TEST_USDC_FAUCET = 25_000_000n;

/** The words the placeholder card shows. Plain on purpose: it does nothing but exercise paying. */
export const PLACEHOLDER_NAME = "Test item";

/**
 * Whether the Shop shows at all: the switch is on, the network is a test network, and the Shop and
 * USDC are both in this network's registry. Mainnet stays off whatever the switch says, until real
 * items exist and this rule is changed on purpose.
 */
export function shopOn(a: { flag: string | undefined; isTestnet: boolean; shop: string | null; usdc: string | null }): boolean {
  return a.flag === "true" && a.isTestnet && !!a.shop && !!a.usdc;
}

/** The card an item gets, or null when it isn't shown (no metadata on mainnet, or switched off). */
export function cardFor(item: RegistryItem, meta: ItemMeta | null, isTestnet: boolean): ShopCard | null {
  if (!item.active) return null;
  if (meta) return { kind: "item", item, meta };
  return isTestnet ? { kind: "placeholder", item, name: PLACEHOLDER_NAME } : null;
}

export type Availability = "on_sale" | "not_yet" | "ended" | "sold_out" | "inactive";

/** Mirrors Shop._buy's checks, so the sheet never offers a buy the contract would refuse. */
export function availability(item: RegistryItem, nowSec: number): Availability {
  if (!item.active) return "inactive";
  if (nowSec < item.start) return "not_yet";
  if (item.end !== 0 && nowSec >= item.end) return "ended";
  if (item.maxSupply !== 0 && item.sold >= item.maxSupply) return "sold_out";
  return "on_sale";
}

/** The shown cards, in registry order. */
export function shopCards(
  items: readonly RegistryItem[],
  metaOf: (id: number) => ItemMeta | null,
  isTestnet: boolean,
): ShopCard[] {
  return items.map((it) => cardFor(it, metaOf(it.id), isTestnet)).filter((c): c is ShopCard => c !== null);
}

/** USDC units (6 decimals) as dollars and cents: 1_000_000n → "1.00". Never a float. */
export function fmtUsdc(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const cents = (abs + 5_000n) / 10_000n; // round half up to the cent
  const s = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** How a USDC amount reads in the app: real USDC as dollars, test USDC never as dollars. */
export function usdcLabel(units: bigint, isTestnet: boolean): string {
  return isTestnet ? `${fmtUsdc(units)} test USDC` : `$${fmtUsdc(units)}`;
}
