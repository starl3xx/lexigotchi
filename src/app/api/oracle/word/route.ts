import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { fetchWordPrice } from "@/lib/oracle/wordPrice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — the live $WORD price (GeckoTerminal, 60s server cache, constant fallback).
 *
 * Public and cheap: the CDN header lets Vercel's edge absorb repeat traffic, the module cache
 * absorbs what gets through, and GeckoTerminal sees at most one call a minute per instance. The
 * response always answers — `source: "fallback"` is how a degraded oracle looks, never a 500.
 */
export async function GET(req: Request) {
  if (!(await allow("oracle", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const price = await fetchWordPrice();
  return NextResponse.json(
    { ok: true, ...price },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
