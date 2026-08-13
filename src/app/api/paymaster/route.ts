import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ERC-7677 paymaster proxy — the wallet-facing half of gas sponsorship.
 *
 * Wallets discover this URL via the `paymasterService` capability on wallet_sendCalls and POST
 * pm_* JSON-RPC here to get sponsorship data. The real paymaster (Coinbase Developer Platform)
 * lives behind PAYMASTER_URL, which embeds an API key — it must NEVER reach the client, so the
 * capability advertises THIS route and this route forwards.
 *
 * WHO can be sponsored is not decided here: the CDP policy (contract allowlist + per-address
 * limits, configured in the CDP dashboard) is the authority. This proxy only narrows the method
 * surface to the two ERC-7677 calls and buckets abusers by IP.
 */
const ALLOWED = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData"]);

export async function POST(req: Request) {
  const upstream = process.env.PAYMASTER_URL;
  if (!upstream) return NextResponse.json({ error: "paymaster_unconfigured" }, { status: 503 });
  if (!(await allow("oracle", clientIp(req)))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { method?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.method || !ALLOWED.has(body.method)) {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 400 });
  }

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    console.error("[paymaster] upstream failed:", err);
    return NextResponse.json({ error: "paymaster_unavailable" }, { status: 502 });
  }
}
