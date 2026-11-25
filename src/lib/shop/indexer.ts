/**
 * Fills the wardrobe from the Shop's `Purchased` events (decisions.md #22). Server-only.
 *
 * Two ways in, both idempotent on (chain, transaction, log index):
 * - `catchUp`: every Purchased event since the last indexed block (or the Shop's deploy block), then
 *   the cursor moves. A wardrobe read and the keeper both call it, so a purchase shows up even if the
 *   buyer closed the page.
 * - `recordTransaction`: one purchase's receipt, right after the buyer's wallet sends it, so the item
 *   shows at once. It never moves the cursor (a later catch-up reads the same log and skips it).
 *
 * The event's `recipient` is the wallet the item was bought for; its profile is resolved here and kept
 * with the row, and reads resolve it again (a wallet may join a profile later).
 */
import { getAbiItem, parseEventLogs, type Hash } from "viem";
import { shopAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { isRangeLimit } from "@/lib/onchain/logs";
import { shopAddress, shopDeployBlock } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { accountsOf } from "@/lib/db/walletLinks";
import { indexedThrough, markIndexed, recordPurchases, type PurchaseRow } from "@/lib/db/shop";

const PURCHASED = getAbiItem({ abi: shopAbi, name: "Purchased" });

interface PurchasedLog {
  transactionHash: Hash | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  args: {
    buyer: `0x${string}`;
    recipient: `0x${string}`;
    itemId: bigint;
    priceUsdc: bigint;
    toStudio: bigint;
    wordToPool: bigint;
    deferredUsdc: bigint;
  };
}

async function toRows(shop: `0x${string}`, logs: readonly PurchasedLog[]): Promise<PurchaseRow[]> {
  const settled = logs.filter((l) => l.transactionHash && l.logIndex !== null && l.blockNumber !== null);
  const accounts = await accountsOf(settled.map((l) => l.args.recipient));
  return settled.map((l) => {
    const recipient = l.args.recipient.toLowerCase();
    return {
      chainId: NETWORK.id,
      shop,
      itemId: Number(l.args.itemId),
      txHash: l.transactionHash!.toLowerCase(),
      logIndex: l.logIndex!,
      blockNumber: Number(l.blockNumber!),
      buyer: l.args.buyer,
      recipient,
      profile: accounts.get(recipient) ?? recipient,
      priceUsdc: Number(l.args.priceUsdc),
      toStudio: Number(l.args.toStudio),
      wordToPool: l.args.wordToPool.toString(),
      deferredUsdc: Number(l.args.deferredUsdc),
    };
  });
}


/** Ranges read per catch-up at most, so one call can't run for minutes on a narrow RPC. */
const MAX_RANGES_PER_CATCH_UP = 60;

/**
 * Read every Purchased event since the last indexed block, record it, and move the cursor after each
 * range read, so a catch-up cut short resumes where it stopped. It asks for the whole span first, and
 * halves the span while the RPC refuses it as too wide (down to 100 blocks).
 */
export async function catchUp(): Promise<{ recorded: number; through: number } | null> {
  const shop = shopAddress();
  if (!shop) return null;
  const client = getPublicClient();
  const latest = Number(await client.getBlockNumber());
  const last = await indexedThrough(NETWORK.id, shop);
  let from = Math.max(last === null ? Number(shopDeployBlock()) : last + 1, Number(shopDeployBlock()));
  if (from > latest) return { recorded: 0, through: latest };
  let span = latest - from + 1;
  let recorded = 0;
  let through = from - 1;
  for (let i = 0; i < MAX_RANGES_PER_CATCH_UP && from <= latest; i++) {
    const to = Math.min(latest, from + span - 1);
    let logs: PurchasedLog[];
    try {
      logs = (await client.getLogs({ address: shop, event: PURCHASED, fromBlock: BigInt(from), toBlock: BigInt(to) })) as unknown as PurchasedLog[];
    } catch (err) {
      if (!isRangeLimit(err) || span <= 100) throw err;
      span = Math.max(100, Math.floor(span / 2));
      continue;
    }
    recorded += await recordPurchases(await toRows(shop.toLowerCase() as `0x${string}`, logs));
    await markIndexed(NETWORK.id, shop, to);
    through = to;
    from = to + 1;
  }
  return { recorded, through };
}

/** Record the purchases in one transaction (the buyer's, just sent). Null while it hasn't landed. */
export async function recordTransaction(hash: Hash): Promise<number | null> {
  const shop = shopAddress();
  if (!shop) return null;
  const receipt = await getPublicClient()
    .getTransactionReceipt({ hash })
    .catch(() => null);
  if (!receipt) return null;
  const logs = parseEventLogs({ abi: shopAbi, eventName: "Purchased", logs: receipt.logs }).filter(
    (l) => l.address.toLowerCase() === shop.toLowerCase(),
  ) as unknown as PurchasedLog[];
  return recordPurchases(await toRows(shop.toLowerCase() as `0x${string}`, logs));
}
