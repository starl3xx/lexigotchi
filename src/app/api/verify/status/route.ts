import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isCoinbaseVerified } from "@/lib/onchain/verifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallet=0x...` — is this wallet Coinbase-verified (and therefore daily-eligible)?
 *
 * Read-only and unauthenticated: it answers a question anyone can answer themselves against public
 * mainnet state, so there is nothing to protect beyond our RPC quota (the IP rate limit).
 *
 * Three honest answers, and the third matters: `verified: true`, `verified: false`, or a 502 for
 * "could not check". A route that mapped RPC failure to `false` would tell verified players they
 * aren't — the UI treats 502 as unknown and keeps the door open for a retry.
 */
export async function GET(req: Request) {
  if (!(await allow("verify-status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  }

  try {
    const verified = await isCoinbaseVerified(wallet);
    return NextResponse.json({ ok: true, verified });
  } catch (err) {
    console.error("[verify] attestation check failed:", err);
    return NextResponse.json({ ok: false, error: "verification_unavailable" }, { status: 502 });
  }
}
