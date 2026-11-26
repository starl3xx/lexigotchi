/**
 * The Market's database side (migration 0017; decisions.md #30): letters for sale (`letter_listings`,
 * a bulletin board of signed Seaport orders, never the truth about what can fill) and sales
 * (`market_sales`, a copy of the chain's `OrderFulfilled` history). Every read treats a missing table
 * as "nothing yet", so the app works before the migration runs; writes let the error through, and
 * the routes answer `not_configured`.
 *
 * Prices are numeric(78,0) wei, so "the cheapest of a letter" and "the average this month" are SQL's
 * to work out, however many rows there are. They come back as decimal strings.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { letterListings, marketSales } from "./schema";
import { isMissingTable } from "./profiles";

export type LetterRow = typeof letterListings.$inferSelect;
export type SaleRow = typeof marketSales.$inferSelect;

async function orEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Are the Market's own tables there (migration 0017)? Until they are, the Market says letters aren't
 * open yet instead of letting a player approve and sign a listing that can't be kept, and the sales
 * reader doesn't walk the chain for rows it can't store. Asked again every 30 s while one is missing,
 * and never again once both are seen.
 */
let tables: { letters: boolean; sales: boolean; at: number } | null = null;
export async function marketTables(): Promise<{ letters: boolean; sales: boolean }> {
  if (tables && ((tables.letters && tables.sales) || Date.now() - tables.at < 30_000)) return tables;
  const there = async (probe: () => Promise<unknown>) => {
    try {
      await probe();
      return true;
    } catch (err) {
      if (isMissingTable(err)) return false;
      throw err;
    }
  };
  const [letters, sales] = await Promise.all([
    there(() => getDb().select({ id: letterListings.id }).from(letterListings).limit(1)),
    there(() => getDb().select({ chainId: marketSales.chainId }).from(marketSales).limit(1)),
  ]);
  tables = { letters, sales, at: Date.now() };
  return tables;
}

// ── letters for sale ───────────────────────────────────────────────────────────────────────────

export async function insertLetterListing(row: typeof letterListings.$inferInsert): Promise<void> {
  await getDb().insert(letterListings).values(row).onConflictDoNothing();
}

/**
 * List `row` unless `blocked` says another of this seller's rows for the letter is still live, with
 * the check and the insert under one lock for that seller and letter. Without the lock, two
 * listings sent together both pass the check and both land, and the one the seller forgets stays
 * fillable at its old price (Bugbot on #219). `blocked` gets the seller's other rows, read inside
 * the lock, and answers from the chain. Returns whether it listed.
 */
export async function listLetterUnlessLive(
  row: typeof letterListings.$inferInsert,
  blocked: (others: LetterRow[]) => Promise<boolean>,
): Promise<boolean> {
  const maker = row.maker.toLowerCase();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lexigotchi:letter_listing:${maker}:${row.letterId}`}))`);
    const rows = await tx.select().from(letterListings).where(and(eq(letterListings.maker, maker), eq(letterListings.letterId, row.letterId)));
    const others = rows.filter((r) => r.orderHash !== row.orderHash);
    if (others.length > 0 && (await blocked(others))) return false;
    await tx.insert(letterListings).values({ ...row, maker }).onConflictDoNothing();
    return true;
  });
}

/** One seller's rows for one letter id: the "one live listing per seller per letter" check, and what to cancel first. */
export function letterRowsOfMakerLetter(maker: string, letterId: number): Promise<LetterRow[]> {
  return orEmpty(() =>
    getDb().select().from(letterListings).where(and(eq(letterListings.maker, maker.toLowerCase()), eq(letterListings.letterId, letterId))),
  );
}

export async function letterRowByHash(orderHash: string): Promise<LetterRow | null> {
  const rows = await orEmpty(() => getDb().select().from(letterListings).where(eq(letterListings.orderHash, orderHash.toLowerCase())).limit(1));
  return rows[0] ?? null;
}

/** Every row these sellers have, newest first: a player's own listings, including ones that can't fill now. */
export function letterRowsOfMakers(makers: readonly string[]): Promise<LetterRow[]> {
  if (makers.length === 0) return Promise.resolve([]);
  return orEmpty(() =>
    getDb()
      .select()
      .from(letterListings)
      .where(inArray(letterListings.maker, makers.map((m) => m.toLowerCase())))
      .orderBy(desc(letterListings.createdAt))
      .limit(400),
  );
}

/**
 * The cheapest rows of EVERY letter id, `perLetter` each, skipping the first `skip` of each: the top
 * of all 52 books in one read, whatever the table's size (the (letter_id, unit_price_wei) index).
 */
export function letterBookTops(perLetter: number, skip = 0): Promise<LetterRow[]> {
  return orEmpty(async () => {
    const ranked = getDb()
      .select({
        id: letterListings.id,
        rn: sql<number>`row_number() over (partition by ${letterListings.letterId} order by ${letterListings.unitPriceWei} asc, ${letterListings.id} asc)`.as("rn"),
      })
      .from(letterListings)
      .as("ranked");
    return getDb()
      .select({ row: letterListings })
      .from(letterListings)
      .innerJoin(ranked, eq(ranked.id, letterListings.id))
      .where(sql`${ranked.rn} > ${skip} and ${ranked.rn} <= ${skip + perLetter}`)
      .orderBy(asc(letterListings.letterId), asc(letterListings.unitPriceWei), asc(letterListings.id))
      .then((rows) => rows.map((r) => r.row));
  });
}

/** One letter's rows, cheapest first, a page at a time. */
export function letterRowsOfLetter(letterId: number, limit: number, offset: number): Promise<LetterRow[]> {
  return orEmpty(() =>
    getDb()
      .select()
      .from(letterListings)
      .where(eq(letterListings.letterId, letterId))
      .orderBy(asc(letterListings.unitPriceWei), asc(letterListings.id))
      .limit(limit)
      .offset(offset),
  );
}

/** How many rows each letter id has (not checked against the chain: a count for "more to see", never for sale). */
export async function letterRowCounts(): Promise<Map<number, number>> {
  const rows = await orEmpty(() =>
    getDb()
      .select({ letterId: letterListings.letterId, n: sql<number>`count(*)::int`.as("n") })
      .from(letterListings)
      .groupBy(letterListings.letterId),
  );
  return new Map(rows.map((r) => [r.letterId, Number(r.n)]));
}

export async function deleteLetterRows(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb().delete(letterListings).where(inArray(letterListings.id, [...ids]));
}

// ── sales ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Record sales, and hand back the rows that were NEW. Idempotent on (chain, transaction, log
 * index): reading a log twice is a no-op, and gives nothing back the second time. That is what
 * makes "tell the seller" safe to hang on it (lib/notify/sold.ts): however many servers read the
 * same sale, one of them inserts it, and only that one hears of it.
 */
export async function recordNewSales(rows: readonly (typeof marketSales.$inferInsert)[]): Promise<SaleRow[]> {
  if (rows.length === 0) return [];
  return getDb().insert(marketSales).values([...rows]).onConflictDoNothing().returning();
}

/** Record sales; how many were new. */
export async function recordSales(rows: readonly (typeof marketSales.$inferInsert)[]): Promise<number> {
  return (await recordNewSales(rows)).length;
}

/** The latest sales, newest first; `word` narrows to one word's history. */
export function recentSales(chainId: number, limit: number, word?: string): Promise<SaleRow[]> {
  return orEmpty(() =>
    getDb()
      .select()
      .from(marketSales)
      .where(word ? and(eq(marketSales.chainId, chainId), eq(marketSales.word, word)) : eq(marketSales.chainId, chainId))
      .orderBy(desc(marketSales.soldAt), desc(marketSales.logIndex))
      .limit(limit),
  );
}

/** What these sellers sold between two moments (the weekly digest: lib/notify/digest.ts). */
export function salesBySellers(chainId: number, sellers: readonly string[], since: Date, until: Date): Promise<Pick<SaleRow, "seller" | "buyer" | "kind" | "qty" | "priceWei" | "feeWei" | "soldAt">[]> {
  if (sellers.length === 0) return Promise.resolve([]);
  return orEmpty(() =>
    getDb()
      .select({ seller: marketSales.seller, buyer: marketSales.buyer, kind: marketSales.kind, qty: marketSales.qty, priceWei: marketSales.priceWei, feeWei: marketSales.feeWei, soldAt: marketSales.soldAt })
      .from(marketSales)
      .where(
        and(
          eq(marketSales.chainId, chainId),
          inArray(marketSales.seller, sellers.map((s) => s.toLowerCase())),
          // ISO strings, never JS Dates: a Date parameter in raw SQL shifts by the server's offset.
          gte(marketSales.soldAt, sql`${since.toISOString()}::timestamptz`),
          sql`${marketSales.soldAt} < ${until.toISOString()}::timestamptz`,
        ),
      ),
  );
}

export interface LetterSaleStat {
  letterId: number;
  /** What one letter went for in the latest sale, wei. */
  lastUnitWei: string;
  lastAt: Date;
  /** The average for one letter over the window (every letter sold counts once), wei, and how many sold. */
  avgUnitWei: string;
  units: number;
}

/** Per letter id: the latest sale, and the average per letter over the last `days`. */
export async function letterSaleStats(chainId: number, days = 30): Promise<LetterSaleStat[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [last, avg] = await Promise.all([
    orEmpty(() =>
      getDb()
        .selectDistinctOn([marketSales.letterId], {
          letterId: marketSales.letterId,
          unit: sql<string>`floor(${marketSales.priceWei} / ${marketSales.qty})::text`.as("unit"),
          soldAt: marketSales.soldAt,
        })
        .from(marketSales)
        .where(and(eq(marketSales.chainId, chainId), eq(marketSales.kind, "letter")))
        .orderBy(marketSales.letterId, desc(marketSales.soldAt)),
    ),
    orEmpty(() =>
      getDb()
        .select({
          letterId: marketSales.letterId,
          avg: sql<string>`floor(sum(${marketSales.priceWei}) / sum(${marketSales.qty}))::text`.as("avg"),
          units: sql<number>`sum(${marketSales.qty})::int`.as("units"),
        })
        .from(marketSales)
        // An ISO string, never a JS Date: a Date parameter in raw SQL shifts by the server's offset.
        .where(and(eq(marketSales.chainId, chainId), eq(marketSales.kind, "letter"), gte(marketSales.soldAt, sql`${since}::timestamptz`)))
        .groupBy(marketSales.letterId),
    ),
  ]);
  const avgOf = new Map(avg.map((a) => [a.letterId, a]));
  return last
    .filter((l) => l.letterId !== null)
    .map((l) => ({
      letterId: l.letterId!,
      lastUnitWei: l.unit,
      lastAt: l.soldAt,
      avgUnitWei: avgOf.get(l.letterId)?.avg ?? l.unit,
      units: Number(avgOf.get(l.letterId)?.units ?? 0),
    }));
}

export interface TierSaleStat {
  tier: string;
  sales: number;
  avgWei: string;
  lowWei: string;
  highWei: string;
}

/** Per rarity tier: how many words sold over the last `days`, and for how much. */
export async function tierSaleStats(chainId: number, days = 30): Promise<TierSaleStat[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await orEmpty(() =>
    getDb()
      .select({
        tier: marketSales.tier,
        sales: sql<number>`count(*)::int`.as("sales"),
        avg: sql<string>`floor(avg(${marketSales.priceWei}))::text`.as("avg"),
        low: sql<string>`min(${marketSales.priceWei})::text`.as("low"),
        high: sql<string>`max(${marketSales.priceWei})::text`.as("high"),
      })
      .from(marketSales)
      .where(and(eq(marketSales.chainId, chainId), eq(marketSales.kind, "word"), gte(marketSales.soldAt, sql`${since}::timestamptz`)))
      .groupBy(marketSales.tier),
  );
  return rows.filter((r) => r.tier !== null).map((r) => ({ tier: r.tier!, sales: Number(r.sales), avgWei: r.avg, lowWei: r.low, highWei: r.high }));
}

/** The latest sale of each of these words (a word that never sold is absent). */
export async function lastWordSales(chainId: number, words: readonly string[]): Promise<Map<string, { priceWei: string; soldAt: Date }>> {
  if (words.length === 0) return new Map();
  const rows = await orEmpty(() =>
    getDb()
      .selectDistinctOn([marketSales.word], { word: marketSales.word, priceWei: marketSales.priceWei, soldAt: marketSales.soldAt })
      .from(marketSales)
      .where(and(eq(marketSales.chainId, chainId), eq(marketSales.kind, "word"), inArray(marketSales.word, [...words])))
      .orderBy(marketSales.word, desc(marketSales.soldAt)),
  );
  return new Map(rows.filter((r) => r.word !== null).map((r) => [r.word!, { priceWei: r.priceWei, soldAt: r.soldAt }]));
}
