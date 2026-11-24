import { NextResponse } from "next/server";
import { isHex } from "viem";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { getPublicClient } from "@/lib/onchain/reads";
import { getMainnetClient } from "@/lib/onchain/mainnet";
import { checkChallenge, issueSession, profileSecret, profilesEnabled, verifyWalletSignature } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `{ message, signature }` → `{ token, address, expiresAt }`: a 30-day wallet session for the
 * profile. The message must be a challenge we issued (our domain, a fresh nonce for that wallet),
 * and the signature must be that wallet's, including a contract wallet's (lib/profile/session.ts).
 */
export async function POST(req: Request) {
  const secret = profileSecret();
  if (!profilesEnabled() || !secret) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { message?: string; signature?: string } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string" || !isHex(body.signature)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const challenge = checkChallenge(secret, body.message, quickAuthDomain(req));
  if (!challenge.ok) return NextResponse.json({ ok: false, error: challenge.reason }, { status: 401 });
  const valid = await verifyWalletSignature(challenge.address, body.message, body.signature, [getPublicClient(), getMainnetClient()]);
  if (!valid) return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  const { token, expiresAt } = issueSession(secret, challenge.address);
  return NextResponse.json({ ok: true, token, address: challenge.address.toLowerCase(), expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
