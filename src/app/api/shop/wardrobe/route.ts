/**
 * GET /api/shop/wardrobe?wallets=a,b: what these wallets' profiles bought (decisions.md #22). Every
 * wallet in each named wallet's profile counts, so linked wallets share one wardrobe. It first reads
 * any Purchased events the wardrobe hasn't seen (lib/shop/indexer `catchUp`, at most every 20 s per
 * server), so a purchase shows even if the buyer left before the app recorded it. Public, like saved
 * scenes: cosmetics are for showing.
 */
import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { parseWallets } from "@/lib/sceneSaves";
import { shopEnabled } from "@/lib/shop/config";
import { catchUp } from "@/lib/shop/indexer";
import { wardrobeOf } from "@/lib/db/shop";
import { accountsOf, walletsOfAccount } from "@/lib/db/walletLinks";
import { shopAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATCH_UP_EVERY_MS = 20_000;
let lastCatchUp = 0;

export async function GET(req: Request) {
  if (!shopEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const wallets = parseWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });
  if (!(await allow("wardrobe-read", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  if (Date.now() - lastCatchUp > CATCH_UP_EVERY_MS) {
    lastCatchUp = Date.now();
    // A failed catch-up still answers with what's recorded; the next read tries again.
    await catchUp().catch((err) => console.warn("[wardrobe] catch-up failed:", String(err?.message ?? err).slice(0, 120)));
  }
  const accounts = await accountsOf(wallets);
  const all = new Set(wallets);
  for (const account of new Set(accounts.values())) {
    for (const w of await walletsOfAccount(account).catch(() => [account])) all.add(w.toLowerCase());
  }
  const owned = await wardrobeOf(NETWORK.id, shopAddress()!, [...all]);
  return NextResponse.json(
    { ok: true, items: owned.map((o) => ({ itemId: o.itemId, count: o.count, firstAt: o.firstAt.getTime() })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
