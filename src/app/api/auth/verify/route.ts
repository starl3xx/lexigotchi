import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { quickAuthClient, QUICK_AUTH_DOMAIN } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — exchange a SIWF credential for a Quick Auth JWT. Body: `{ message, signature }`
 *
 * The final step of web sign-in, and the reason this migration adds capability rather than just
 * restoring an avatar: the token minted here is byte-for-byte the same kind the mini-app SDK mints
 * inside a Farcaster host — same issuer, same `sub` (the FID), same `aud`. So `getAuthedFid` accepts
 * it with NO server changes, and every authed route works for a web player.
 *
 * `domain` is supplied by US, never by the caller. Quick Auth checks it against the domain inside the
 * signed SIWF message, so a message signed for another site cannot be redeemed here — and a caller
 * who could name the domain would defeat exactly that check.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await allow("auth-verify", ip))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let message: unknown;
  let signature: unknown;
  try {
    const body = await req.json();
    message = body?.message;
    signature = body?.signature;
  } catch {
    /* handled below */
  }
  if (typeof message !== "string" || typeof signature !== "string" || !message || !signature) {
    return NextResponse.json({ ok: false, error: "bad_credential" }, { status: 400 });
  }

  try {
    const { token } = await quickAuthClient.verifySiwf({
      message,
      signature,
      domain: QUICK_AUTH_DOMAIN,
    });
    return NextResponse.json({ ok: true, token });
  } catch (err) {
    // Distinguish "your credential is wrong" from "the upstream is unhappy": a stale/replayed nonce
    // and a domain mismatch are both client-fixable and both land here.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[auth] siwf verification failed:", detail);
    return NextResponse.json({ ok: false, error: "invalid_credential", detail }, { status: 401 });
  }
}
