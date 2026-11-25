/**
 * GET /api/admin/shop: the Shop for the operator console (decisions.md #22): revenue to date, $WORD
 * sent to the pool, USDC waiting now, sales per item, and the live settings (split, floor, sweep size,
 * pause, the route and any pending change). Public chain data and public metadata, like
 * /api/admin/live, so it's open and edge-cached; nothing about any player.
 */
import { NextResponse } from "next/server";
import { getAbiItem } from "viem";
import { shopAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { shopAddress, shopDeployBlock, usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { readShop } from "@/lib/shop/registry";
import { itemMetadata } from "@/lib/db/shop";
import { shopTotals } from "@/lib/admin/shopStats";
import { shopEnabled } from "@/lib/shop/config";

export const dynamic = "force-dynamic";

const PURCHASED = getAbiItem({ abi: shopAbi, name: "Purchased" });
const SWEPT = getAbiItem({ abi: shopAbi, name: "Swept" });

export async function GET() {
  const shop = shopAddress();
  if (!shop) return NextResponse.json({ ok: true, deployed: false, network: NETWORK.name });
  const client = getPublicClient();
  const from = shopDeployBlock();
  const [state, purchases, sweeps, settings, meta] = await Promise.all([
    readShop(),
    client.getLogs({ address: shop, event: PURCHASED, fromBlock: from, toBlock: "latest" }),
    client.getLogs({ address: shop, event: SWEPT, fromBlock: from, toBlock: "latest" }),
    client.multicall({
      allowFailure: false,
      contracts: [
        { address: shop, abi: shopAbi, functionName: "revenueWallet" },
        { address: shop, abi: shopAbi, functionName: "maxSlippageBps" },
        { address: shop, abi: shopAbi, functionName: "maxSweepUsdc" },
        { address: shop, abi: shopAbi, functionName: "adapter" },
        { address: shop, abi: shopAbi, functionName: "pegSource" },
        { address: shop, abi: shopAbi, functionName: "pegPackUsdc" },
        { address: shop, abi: shopAbi, functionName: "pendingRoute" },
        { address: shop, abi: shopAbi, functionName: "owner" },
      ],
    }),
    itemMetadata(NETWORK.id, shop).catch(() => new Map()),
  ]);
  const floor1 = await client
    .readContract({ address: shop, abi: shopAbi, functionName: "floorFor", args: [1_000_000n] })
    .catch(() => null);
  const totals = shopTotals(
    purchases.map((l) => ({
      itemId: Number(l.args.itemId),
      priceUsdc: l.args.priceUsdc!,
      toStudio: l.args.toStudio!,
      wordToPool: l.args.wordToPool!,
      deferredUsdc: l.args.deferredUsdc!,
    })),
    sweeps.map((l) => ({ usdcIn: l.args.usdcIn!, wordOut: l.args.wordOut!, strayWord: l.args.strayWord! })),
  );
  const [revenueWallet, maxSlippageBps, maxSweepUsdc, adapter, pegSource, pegPackUsdc, pending, owner] = settings as [
    string, number, bigint, string, string, bigint, readonly [string, string, bigint, bigint], string,
  ];
  const s = (v: bigint) => v.toString();
  return NextResponse.json(
    {
      ok: true,
      deployed: true,
      network: NETWORK.name,
      enabled: shopEnabled(),
      shop,
      usdc: usdcAddress(),
      owner,
      revenueWallet,
      revenueBps: state?.revenueBps ?? null,
      maxSlippageBps: Number(maxSlippageBps),
      maxSweepUsdc: s(maxSweepUsdc),
      paused: state?.paused ?? null,
      adapter,
      pegSource,
      pegPackUsdc: s(pegPackUsdc),
      floorPerUsdc: floor1 === null ? null : s(floor1 as bigint),
      pendingRoute:
        pending[3] === 0n ? null : { adapter: pending[0], pegSource: pending[1], pegPackUsdc: s(pending[2]), readyAt: Number(pending[3]) },
      pendingUsdc: s(state?.pendingUsdc ?? 0n),
      totals: {
        sales: totals.sales,
        grossUsdc: s(totals.grossUsdc),
        revenueUsdc: s(totals.revenueUsdc),
        wordToPool: s(totals.wordToPool),
        deferredEverUsdc: s(totals.deferredEverUsdc),
        sweptUsdc: s(totals.sweptUsdc),
      },
      items: (state?.items ?? []).map((it) => {
        const t = totals.perItem.get(it.id);
        return {
          id: it.id,
          name: meta.get(it.id)?.name ?? null,
          kind: meta.get(it.id)?.kind ?? null,
          priceUsdc: s(it.priceUsdc),
          start: it.start,
          end: it.end,
          maxSupply: it.maxSupply,
          sold: it.sold,
          active: it.active,
          grossUsdc: s(t?.grossUsdc ?? 0n),
          revenueUsdc: s(t?.revenueUsdc ?? 0n),
        };
      }),
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
  );
}
