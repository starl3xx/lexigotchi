/**
 * The Shop's registry as the app sees it (decisions.md #22): every item's price, window, and supply,
 * read from the chain in one block, plus the split and the waiting USDC. Server and client safe.
 */
import { shopAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { shopAddress } from "@/lib/onchain/addresses";
import type { RegistryItem } from "./rules";

export interface ShopState {
  items: RegistryItem[];
  revenueBps: number;
  paused: boolean;
  /** USDC units waiting for `sweep`. */
  pendingUsdc: bigint;
}

/** Items past this are not read (a guard on a runaway registry; real drops are monthly). */
export const MAX_ITEMS_READ = 200;

export async function readShop(): Promise<ShopState | null> {
  const shop = shopAddress();
  if (!shop) return null;
  const client = getPublicClient();
  const [count, revenueBps, paused, pendingUsdc] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: shop, abi: shopAbi, functionName: "itemCount" },
      { address: shop, abi: shopAbi, functionName: "revenueBps" },
      { address: shop, abi: shopAbi, functionName: "paused" },
      { address: shop, abi: shopAbi, functionName: "pendingUsdc" },
    ],
  });
  const n = Math.min(Number(count), MAX_ITEMS_READ);
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const raw = n
    ? await client.multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({ address: shop, abi: shopAbi, functionName: "item" as const, args: [BigInt(id)] as const })),
      })
    : [];
  const items: RegistryItem[] = raw.map((r, i) => {
    const it = r as { priceUsdc: bigint; start: bigint; end: bigint; maxSupply: number; sold: number; active: boolean };
    return {
      id: ids[i],
      priceUsdc: it.priceUsdc,
      start: Number(it.start),
      end: Number(it.end),
      maxSupply: Number(it.maxSupply),
      sold: Number(it.sold),
      active: it.active,
    };
  });
  return { items, revenueBps: Number(revenueBps), paused: paused as boolean, pendingUsdc: pendingUsdc as bigint };
}
