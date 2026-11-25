/**
 * The Shop's database side (migration 0016; decisions.md #22): the wardrobe (one row per purchase,
 * from `Purchased`), what each item is (`shop_items`, empty until real items are added), and how far
 * the wardrobe has read each Shop's events (`shop_index`). Every read treats a missing table as
 * "nothing yet", so the app works before the migration runs.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { shopIndex, shopItems, wardrobe } from "./schema";
import { isMissingTable } from "./profiles";
import { isItemKind, type ItemMeta } from "@/lib/shop/rules";

export interface PurchaseRow {
  chainId: number;
  shop: string;
  itemId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  buyer: string;
  recipient: string;
  profile: string;
  priceUsdc: number;
  toStudio: number;
  wordToPool: string;
  deferredUsdc: number;
}

/** Record purchases. Idempotent on (chain, transaction, log index): a second index of a log is a no-op. */
export async function recordPurchases(rows: readonly PurchaseRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await getDb()
    .insert(wardrobe)
    .values(rows.map((r) => ({ ...r, shop: r.shop.toLowerCase(), buyer: r.buyer.toLowerCase(), recipient: r.recipient.toLowerCase(), profile: r.profile.toLowerCase() })))
    .onConflictDoNothing()
    .returning({ txHash: wardrobe.txHash });
  return res.length;
}

/** The last block indexed for a Shop, or null (never indexed, or no table yet). */
export async function indexedThrough(chainId: number, shop: string): Promise<number | null> {
  try {
    const rows = await getDb()
      .select({ lastBlock: shopIndex.lastBlock })
      .from(shopIndex)
      .where(and(eq(shopIndex.chainId, chainId), eq(shopIndex.shop, shop.toLowerCase())))
      .limit(1);
    return rows[0]?.lastBlock ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Move a Shop's index forward to `block` (never back: two readers racing keep the higher). */
export async function markIndexed(chainId: number, shop: string, block: number): Promise<void> {
  await getDb()
    .insert(shopIndex)
    .values({ chainId, shop: shop.toLowerCase(), lastBlock: block, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [shopIndex.chainId, shopIndex.shop],
      set: { lastBlock: sql`GREATEST(${shopIndex.lastBlock}, excluded.last_block)`, updatedAt: sql`now()` },
    });
}

export interface OwnedItem {
  itemId: number;
  /** How many of it these wallets hold (a profile may buy an item more than once). */
  count: number;
  firstAt: Date;
}

/** What these wallets hold in this Shop, by item. A missing table is an empty wardrobe. */
export async function wardrobeOf(chainId: number, shop: string, wallets: readonly string[]): Promise<OwnedItem[]> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return [];
  try {
    const rows = await getDb()
      .select({
        itemId: wardrobe.itemId,
        count: sql<number>`count(*)::int`,
        firstAt: sql<Date>`min(${wardrobe.createdAt})`,
      })
      .from(wardrobe)
      .where(and(eq(wardrobe.chainId, chainId), eq(wardrobe.shop, shop.toLowerCase()), inArray(wardrobe.recipient, list)))
      .groupBy(wardrobe.itemId);
    return rows.map((r) => ({ itemId: r.itemId, count: Number(r.count), firstAt: new Date(r.firstAt) }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** What each of this Shop's items is, by id. Empty until real items are added (and before 0016). */
export async function itemMetadata(chainId: number, shop: string): Promise<Map<number, ItemMeta>> {
  try {
    const rows = await getDb()
      .select()
      .from(shopItems)
      .where(and(eq(shopItems.chainId, chainId), eq(shopItems.shop, shop.toLowerCase())));
    const out = new Map<number, ItemMeta>();
    for (const r of rows) if (isItemKind(r.kind)) out.set(r.itemId, { name: r.name, kind: r.kind, art: r.art });
    return out;
  } catch (err) {
    if (isMissingTable(err)) return new Map();
    throw err;
  }
}
