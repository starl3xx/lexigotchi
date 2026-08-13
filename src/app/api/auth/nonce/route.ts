import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { quickAuthClient } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — mint a Quick Auth nonce for the web sign-in flow.
 *
 * Step 1 of exchanging a SIWF credential for a Quick Auth JWT. The nonce MUST come from Quick Auth's
 * own pool: `/verify-siwf` rejects anything else with `invalid_nonce`, and it is strictly single-use,
 * so every retry — including a React strict-mode double-mount or a user re-scanning the QR — needs a
 * fresh one. Never cache it.
 *
 * Proxied through our own route rather than called from the browser so the origin stays ours and
 * there is one place to rate limit. Keyed by IP because there is no FID until sign-in succeeds —
 * this is the only surface an unauthenticated visitor can reach, and the friction it replaces
 * ("you must be inside a Farcaster host") used to be free.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await allow("auth-nonce", ip))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  try {
    // generateNonce() resolves to { nonce: string }, not a bare string — unwrap it here so the
    // client can pass it straight to createChannel. Handing the object through produced a nonce the
    // relay accepted structurally and /verify-siwf then rejected as invalid, at the very last step.
    const { nonce } = await quickAuthClient.generateNonce();
    return NextResponse.json({ ok: true, nonce });
  } catch (err) {
    console.error("[auth] nonce mint failed:", err);
    return NextResponse.json({ ok: false, error: "nonce_unavailable" }, { status: 502 });
  }
}
