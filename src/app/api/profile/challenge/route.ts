import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { NETWORK } from "@/lib/onchain/network";
import { challengeMessage, profileSecret, profilesEnabled } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST `{ address }` → the Sign-In-With-Ethereum message for that wallet to sign. */
export async function POST(req: Request) {
  const secret = profileSecret();
  if (!profilesEnabled() || !secret) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  if (!body?.address || !isAddress(body.address)) return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  const message = challengeMessage({ secret, address: body.address, domain: quickAuthDomain(req), chainId: NETWORK.id });
  return NextResponse.json({ ok: true, message }, { headers: { "Cache-Control": "no-store" } });
}
