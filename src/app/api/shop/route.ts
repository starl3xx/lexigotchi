/**
 * GET /api/shop: the Shop's registry and what each item is (decisions.md #22). Public chain data and
 * public metadata; nothing about any player. 404 while SHOP_ENABLED is off (and always on mainnet),
 * so a client can't run ahead of the switch. The client turns this into cards with lib/shop/rules.ts.
 *
 * `metaKnown` is false when the database couldn't say what the items are: every `meta` is null
 * then, and that is "not known", never "no item is a scene". A client that decides what a player
 * owns from the metadata (game/useShop) must not read it as an answer.
 */
import { NextResponse } from "next/server";
import { shopEnabled } from "@/lib/shop/config";
import { readShop } from "@/lib/shop/registry";
import { itemMetadata } from "@/lib/db/shop";
import { shopAddress, usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!shopEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const [state, meta] = await Promise.all([
    readShop(),
    itemMetadata(NETWORK.id, shopAddress()!).catch(() => null),
  ]);
  if (!state) return NextResponse.json({ ok: false, error: "not_deployed" }, { status: 503 });
  return NextResponse.json(
    {
      ok: true,
      shop: shopAddress(),
      usdc: usdcAddress(),
      paused: state.paused,
      revenueBps: state.revenueBps,
      metaKnown: meta !== null,
      items: state.items.map((it) => ({ ...it, priceUsdc: it.priceUsdc.toString(), meta: meta?.get(it.id) ?? null })),
    },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
