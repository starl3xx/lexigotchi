/**
 * POST /api/shop/record `{ txHash }`: record the purchases in one transaction, right after the buyer's
 * wallet sends it, so the item is in the wardrobe at once (decisions.md #22). It reads the receipt from
 * the chain and trusts nothing in the request but the hash, so anyone may call it; a repeat is a
 * no-op. `pending` while the transaction hasn't landed: the client asks again.
 */
import { NextResponse } from "next/server";
import { isHash } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { shopEnabled } from "@/lib/shop/config";
import { recordTransaction } from "@/lib/shop/indexer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!shopEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  if (!(await allow("shop-record", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { txHash?: string } | null;
  if (!body?.txHash || !isHash(body.txHash)) return NextResponse.json({ ok: false, error: "bad_hash" }, { status: 400 });
  const recorded = await recordTransaction(body.txHash).catch((err) => {
    console.warn("[shop-record] failed:", String(err?.message ?? err).slice(0, 120));
    return undefined;
  });
  if (recorded === undefined) return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
  if (recorded === null) return NextResponse.json({ ok: true, pending: true });
  return NextResponse.json({ ok: true, recorded });
}
