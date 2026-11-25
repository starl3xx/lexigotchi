/**
 * The letters side of the Market, as the server reads it (decisions.md #29). Server-only.
 *
 * `letter_listings` is a bulletin board: the chain says what can fill. Every row served is checked
 * against Seaport (`getOrderStatus`, the seller's counter) and the Letters contract (the seller's
 * balance and approval), in four multicalls however many rows there are:
 * - **spent** rows can never fill again (sold out, cancelled, expired, or the seller's counter moved)
 *   and are deleted;
 * - a row whose seller holds none of the letter now, or whose approval is off, is **hidden, not
 *   deleted**: the signed order fills again if that changes. The seller sees it as "paused".
 *
 * How many letters a row offers right now is the unsold part of the order, capped by what the seller
 * still holds. A seller's balance is shared across that seller's rows of the same letter, cheapest
 * first, so two rows can never offer the same letter twice.
 *
 * The board reads only the cheapest rows of each letter (`letterBookTops`), so its work is bounded by
 * 52 letters, not by how many listings exist, and it is kept in memory for a few seconds: every
 * player on the Market polls it.
 */
import { SEAPORT, seaportAbi, type SeaportOrder } from "@/lib/onchain/seaport";
import { getPublicClient } from "@/lib/onchain/reads";
import { addressOf, wordTokenAddress } from "@/lib/onchain/addresses";
import { erc1155ApprovalAbi, lettersAbi } from "@/lib/onchain/abis";
import { unsoldLetters } from "@/lib/onchain/letterSale";
import { deleteLetterRows, letterBookTops, letterRowCounts, letterRowsOfLetter, type LetterRow } from "@/lib/db/market";
import type { LetterAsk, LetterBook, MyLetterListing } from "./types";

const WEI = 10n ** 18n;

export interface CheckedLetterRow {
  row: LetterRow;
  order: SeaportOrder;
  /** Can never fill again: delete it. */
  spent: boolean;
  /** Signed for other contracts (another network's rows in a shared database): never shown, never deleted. */
  foreign: boolean;
  unsold: number;
  /** Letters that can be bought now. */
  available: number;
}

const same = (a: string | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();

/** Check rows against the chain. A read that fails leaves its row unspent and unavailable: decided next time. */
export async function checkLetterRows(rows: readonly LetterRow[], nowSeconds = Math.floor(Date.now() / 1000)): Promise<CheckedLetterRow[]> {
  if (rows.length === 0) return [];
  const letters = addressOf("letters");
  const word = wordTokenAddress();
  const saleFees = addressOf("saleFees");
  const client = getPublicClient();
  const makers = [...new Set(rows.map((r) => r.maker))] as `0x${string}`[];
  const holdings = [...new Set(rows.map((r) => `${r.maker}:${r.letterId}`))];
  const [status, held, approved, counters] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: rows.map((r) => ({ address: SEAPORT, abi: seaportAbi, functionName: "getOrderStatus" as const, args: [r.orderHash as `0x${string}`] as const })),
    }),
    client.multicall({
      allowFailure: true,
      contracts: holdings.map((h) => {
        const [maker, id] = h.split(":");
        return { address: letters, abi: lettersAbi, functionName: "balanceOf" as const, args: [maker as `0x${string}`, BigInt(id)] as const };
      }),
    }),
    client.multicall({
      allowFailure: true,
      contracts: makers.map((m) => ({ address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll" as const, args: [m, SEAPORT] as const })),
    }),
    client.multicall({
      allowFailure: true,
      contracts: makers.map((m) => ({ address: SEAPORT, abi: seaportAbi, functionName: "getCounter" as const, args: [m] as const })),
    }),
  ]);
  const approvedBy = new Map(makers.map((m, i) => [m as string, approved[i].status === "success" && approved[i].result === true]));
  const counterOf = new Map(makers.map((m, i) => [m as string, counters[i].status === "success" ? (counters[i].result as bigint) : undefined]));
  // What each seller still has of each letter to give, drawn down as their rows take it.
  const left = new Map(holdings.map((h, i) => [h, held[i].status === "success" ? Number(held[i].result as bigint) : 0]));

  const out: CheckedLetterRow[] = rows.map((row, i) => {
    const order = JSON.parse(row.orderJson) as SeaportOrder;
    const foreign = !same(order.offer?.[0]?.token, letters) || !order.consideration?.every((p) => same(p.token, word)) || !same(order.consideration?.[1]?.recipient, saleFees);
    const s = status[i].status === "success" ? (status[i].result as unknown as readonly [boolean, boolean, bigint, bigint]) : undefined;
    const counter = counterOf.get(row.maker);
    const unsold = s ? unsoldLetters(row.qty, s[2], s[3]) : 0;
    const spent = !foreign && (Number(order.endTime) <= nowSeconds || (!!s && (s[1] || unsold === 0)) || (counter !== undefined && counter !== BigInt(order.counter)));
    return { row, order, spent, foreign, unsold: spent ? 0 : unsold, available: 0 };
  });
  // Cheapest first, so a seller's balance goes to their best-priced row.
  const byPrice = [...out].sort((a, b) => (BigInt(a.row.unitPriceWei) < BigInt(b.row.unitPriceWei) ? -1 : BigInt(a.row.unitPriceWei) > BigInt(b.row.unitPriceWei) ? 1 : a.row.id - b.row.id));
  for (const c of byPrice) {
    if (c.spent || c.foreign || !approvedBy.get(c.row.maker)) continue;
    const key = `${c.row.maker}:${c.row.letterId}`;
    const has = left.get(key) ?? 0;
    c.available = Math.min(c.unsold, has);
    left.set(key, has - c.available);
  }
  return out;
}

/** Delete what can never fill again. Best effort: a failed delete is retried by the next read. */
export async function pruneSpent(checked: readonly CheckedLetterRow[]): Promise<void> {
  const ids = checked.filter((c) => c.spent).map((c) => c.row.id);
  await deleteLetterRows(ids).catch((err) => console.warn("[letters] prune failed:", String(err?.message ?? err).slice(0, 120)));
}

export function toAsk(c: CheckedLetterRow): LetterAsk {
  return {
    orderHash: c.row.orderHash,
    maker: c.row.maker,
    letterId: c.row.letterId,
    unitPrice: Number(BigInt(c.row.unitPriceWei) / WEI),
    available: c.available,
    listedAt: c.row.createdAt.toISOString(),
  };
}

export function toMine(c: CheckedLetterRow): MyLetterListing {
  return { ...toAsk(c), qty: c.row.qty, unsold: c.unsold, state: c.available > 0 ? "live" : "paused" };
}

/** How many of a letter's cheapest rows the board reads, and shows before "more". */
export const BOOK_DEPTH = 6;

const BOOK_TTL_MS = 8_000;
let cached: { at: number; book: Record<number, LetterBook> } | null = null;

/** Drop the kept board, after a listing changes it from here. */
export function bustLetterBook(): void {
  cached = null;
}

/**
 * A player just bought or cancelled: read the chain again for them instead of answering from memory,
 * unless the kept board is under two seconds old (so a caller repeating `fresh` can't make every
 * read a full one).
 */
export function refreshLetterBook(): void {
  if (cached && Date.now() - cached.at >= 2_000) cached = null;
}

/**
 * Every letter's open listings, cheapest first, `BOOK_DEPTH` deep. A letter whose cheapest rows are
 * all paused, with more rows behind them, gets one more page read, so it never looks empty while
 * something further down can be bought.
 */
export async function readLetterBook(): Promise<Record<number, LetterBook>> {
  if (cached && Date.now() - cached.at < BOOK_TTL_MS) return cached.book;
  const [rows, counts] = await Promise.all([letterBookTops(BOOK_DEPTH), letterRowCounts()]);
  const checked = await checkLetterRows(rows);
  await pruneSpent(checked);
  const book: Record<number, LetterBook> = {};
  const add = (list: readonly CheckedLetterRow[]) => {
    for (const c of list) {
      if (c.available <= 0) continue;
      (book[c.row.letterId] ??= { asks: [], more: false }).asks.push(toAsk(c));
    }
  };
  add(checked);
  for (const [letterId, n] of counts) {
    if (n <= BOOK_DEPTH) continue;
    if (book[letterId]) {
      book[letterId].more = true;
      continue;
    }
    const deeper = await checkLetterRows(await letterRowsOfLetter(letterId, 24, BOOK_DEPTH));
    await pruneSpent(deeper);
    add(deeper);
    const found = book[letterId] as LetterBook | undefined;
    if (found) found.more = n > BOOK_DEPTH + 24;
  }
  for (const b of Object.values(book)) b.asks.sort((x, y) => x.unitPrice - y.unitPrice);
  cached = { at: Date.now(), book };
  return book;
}
