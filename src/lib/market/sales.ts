/**
 * Fills `market_sales` from the chain (decisions.md #30). Server-only.
 *
 * A sale on the Market is a Seaport fill that pays the sale fee, so two things on the chain name it:
 * - the $WORD `Transfer` into `SaleFees` (indexed by receiver), which finds every sale's transaction
 *   without reading Seaport's whole log (on Base that is every marketplace's trades);
 * - Seaport's `OrderFulfilled` in that same transaction, which says what sold: the item, how many,
 *   the seller, the buyer, and each payment. For a listing bought in part, it carries the amounts of
 *   that part.
 *
 * Two ways in, both idempotent on (chain, transaction, log index), the Shop wardrobe's pattern:
 * - `catchUpSales`: every fee transfer since the last indexed block, then the cursor moves. The sales
 *   route and the keeper call it, so a sale shows even if the buyer closed the page.
 * - `recordSaleTransaction`: one transaction's receipt, right after the buyer sends it.
 */
import { erc20Abi, getAbiItem, parseEventLogs, type Hash, type TransactionReceipt } from "viem";
import { getPublicClient } from "@/lib/onchain/reads";
import { isRangeLimit } from "@/lib/onchain/logs";
import { addressOf, deployBlock, maybeAddressOf, wordTokenAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { SEAPORT, seaportAbi } from "@/lib/onchain/seaport";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { WORDS } from "@/lib/dictionary";
import { wordTier, type Tier } from "@/lib/economy";
import { NO_COLLAB, tierFn } from "@/lib/rarity";
import { collabNow } from "@/lib/sets/server";
import { indexedThrough, markIndexed } from "@/lib/db/shop";
import { recordNewSales, recordSales, type SaleRow } from "@/lib/db/market";
import type { marketSales } from "@/lib/db/schema";

type SaleInsert = typeof marketSales.$inferInsert;

const TRANSFER = getAbiItem({ abi: erc20Abi, name: "Transfer" });
const ERC20 = 1;
const ERC721 = 2;
const ERC1155 = 3;

/** Token id → word, for the whole dictionary. Built on first use (4,584 hashes, a few milliseconds). */
let wordOfToken: Map<bigint, string> | null = null;
export function wordOfTokenId(id: bigint): string | null {
  wordOfToken ??= new Map(WORDS.map((w) => [tokenIdOf(w), w.toUpperCase()]));
  return wordOfToken.get(id) ?? null;
}

interface FillArgs {
  orderHash: `0x${string}`;
  offerer: `0x${string}`;
  recipient: `0x${string}`;
  offer: readonly { itemType: number; token: `0x${string}`; identifier: bigint; amount: bigint }[];
  consideration: readonly { itemType: number; token: `0x${string}`; identifier: bigint; amount: bigint; recipient: `0x${string}` }[];
}

export interface SaleContracts {
  words: string;
  letters: string;
  word: string;
  saleFees: string;
}

/**
 * One `OrderFulfilled` as a Market sale, or null when it isn't one: it must offer exactly one Word,
 * or some of one letter, for $WORD alone, with part of it paid to SaleFees. Pure, so it is tested.
 */
export function saleOfFill(
  a: FillArgs,
  c: SaleContracts,
  /** The tier a sold word is recorded at: the game's (a collab word sells as Legendary). The derived one when left out. */
  tierOf: (word: string) => Tier = wordTier,
): Omit<SaleInsert, "chainId" | "txHash" | "logIndex" | "blockNumber" | "soldAt"> | null {
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  if (a.offer.length !== 1 || a.consideration.length === 0) return null;
  const item = a.offer[0];
  if (!a.consideration.every((p) => p.itemType === ERC20 && eq(p.token, c.word))) return null;
  const feeWei = a.consideration.filter((p) => eq(p.recipient, c.saleFees)).reduce((s, p) => s + p.amount, 0n);
  if (feeWei === 0n) return null;
  const priceWei = a.consideration.reduce((s, p) => s + p.amount, 0n);
  const base = { orderHash: a.orderHash.toLowerCase(), seller: a.offerer.toLowerCase(), buyer: a.recipient.toLowerCase(), priceWei: priceWei.toString(), feeWei: feeWei.toString() };
  if (item.itemType === ERC721 && eq(item.token, c.words)) {
    const word = wordOfTokenId(item.identifier);
    if (!word || item.amount !== 1n) return null;
    return { ...base, kind: "word", word, tier: tierOf(word), letterId: null, qty: 1 };
  }
  if (item.itemType === ERC1155 && eq(item.token, c.letters)) {
    const id = Number(item.identifier);
    if (!Number.isInteger(id) || id < 0 || id >= 52 || item.amount < 1n || item.amount > 1_000_000n) return null;
    return { ...base, kind: "letter", word: null, tier: null, letterId: id, qty: Number(item.amount) };
  }
  return null;
}

function contracts(): SaleContracts {
  return { words: addressOf("words"), letters: addressOf("letters"), word: wordTokenAddress(), saleFees: addressOf("saleFees") };
}

async function rowsOfReceipt(receipt: TransactionReceipt, soldAt: Date): Promise<SaleInsert[]> {
  const c = contracts();
  // A sale is recorded at the tier the game treats the word as when it sells (a collab word:
  // Legendary). If the sets can't be read, the derived tier: a sale must still be recorded.
  const tierOf = tierFn((await collabNow().catch(() => null))?.words ?? NO_COLLAB);
  const fills = parseEventLogs({ abi: seaportAbi, eventName: "OrderFulfilled", logs: receipt.logs }).filter(
    (l) => l.address.toLowerCase() === SEAPORT.toLowerCase(),
  );
  const rows: SaleInsert[] = [];
  for (const l of fills) {
    const sale = saleOfFill(l.args as unknown as FillArgs, c, tierOf);
    if (!sale) continue;
    rows.push({ ...sale, chainId: NETWORK.id, txHash: receipt.transactionHash.toLowerCase(), logIndex: l.logIndex, blockNumber: Number(receipt.blockNumber), soldAt });
  }
  return rows;
}

async function blockTime(blockNumber: bigint): Promise<Date> {
  const block = await getPublicClient().getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000);
}

/** Record the sales in one transaction (the buyer's, just sent). Null while it hasn't landed. */
export async function recordSaleTransaction(hash: Hash): Promise<number | null> {
  if (!maybeAddressOf("saleFees")) return null;
  const receipt = await getPublicClient().getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return null;
  if (receipt.status !== "success") return 0;
  return recordSales(await rowsOfReceipt(receipt, await blockTime(receipt.blockNumber)));
}

/** Ranges read per catch-up at most, so one call can't run for minutes on a narrow RPC. */
const MAX_RANGES_PER_CATCH_UP = 60;
/**
 * Blocks read again on every catch-up, behind the cursor. An RPC can say a block exists before it
 * serves that block's logs (lib/onchain/settle.ts: reads aren't consistent right after a write), and
 * a cursor moved past such a block would skip its sale for good. About a minute of Base; recording
 * a log twice is a no-op.
 */
const OVERLAP_BLOCKS = 30;

/**
 * Read every fee transfer since the last indexed block (and a short overlap before it), record its
 * transaction's sales, and move the cursor after each range, so a catch-up cut short resumes where
 * it stopped. It asks for the whole span first and halves it while the RPC refuses it as too wide
 * (down to 100 blocks). `onNew` gets each sale this pass was the FIRST to record, as it is recorded
 * (lib/notify/sold.ts tells their sellers), and is awaited: a caller that wants the seller told
 * before the pass goes on (the keeper) returns its promise, and one that must not wait (the
 * Market's route) returns nothing.
 */
export async function catchUpSales(opts: { onNew?: (rows: SaleRow[]) => void | Promise<void> } = {}): Promise<{ recorded: number; through: number } | null> {
  const saleFees = maybeAddressOf("saleFees");
  if (!saleFees) return null;
  const client = getPublicClient();
  const latest = Number(await client.getBlockNumber());
  const start = Number(deployBlock());
  const last = await indexedThrough(NETWORK.id, saleFees);
  let from = Math.max(last === null ? start : last + 1 - OVERLAP_BLOCKS, start);
  if (from > latest) return { recorded: 0, through: latest };
  let span = latest - from + 1;
  let recorded = 0;
  let through = from - 1;
  for (let i = 0; i < MAX_RANGES_PER_CATCH_UP && from <= latest; i++) {
    const to = Math.min(latest, from + span - 1);
    let logs;
    try {
      logs = await client.getLogs({ address: wordTokenAddress(), event: TRANSFER, args: { to: saleFees }, fromBlock: BigInt(from), toBlock: BigInt(to) });
    } catch (err) {
      if (!isRangeLimit(err) || span <= 100) throw err;
      span = Math.max(100, Math.floor(span / 2));
      continue;
    }
    const hashes = [...new Set(logs.map((l) => l.transactionHash).filter((h): h is Hash => !!h))];
    for (const hash of hashes) {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.status !== "success") continue;
      // Handed out the moment they are recorded, never at the end: a later read that throws ends
      // this pass, and a row is only ever "new" once, so a list returned at the end would lose
      // every row recorded before the throw, and its seller would never be told.
      const fresh = await recordNewSales(await rowsOfReceipt(receipt, await blockTime(receipt.blockNumber)));
      recorded += fresh.length;
      if (fresh.length > 0) await opts.onNew?.(fresh);
    }
    await markIndexed(NETWORK.id, saleFees, to);
    through = to;
    from = to + 1;
  }
  return { recorded, through };
}
