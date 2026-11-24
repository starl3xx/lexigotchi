import { NextResponse } from "next/server";
import { sessionAccountOf } from "@/lib/profile/account";
import { quickAuthDomain } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { createLinkState, getProfile, isMissingTable } from "@/lib/db/profiles";
import { xKeyUsedToday } from "@/lib/onchain/dailyIdentity";
import { X_STATE_TTL_MS, authorizeUrl, newState, pkcePair, redirectUri, xEnabled, type XReturn } from "@/lib/profile/x";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `{ return: "redirect" | "page" }` (wallet session required) → `{ url }`: X's consent page for
 * this wallet. The attempt (state, wallet, PKCE verifier) is kept on the server, so the callback can
 * finish it in any browser, which is what happens when a Farcaster host opens X outside its frame.
 */
export async function POST(req: Request) {
  if (!xEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const address = await sessionAccountOf(req); // the profile is the account's (linked wallets)
  if (!address) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  if (!(await allow("profile", clientIp(req)))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  // An X account that took today's letter can't be replaced until tomorrow (dailyIdentity.ts): say
  // so before sending the player off to X.
  const current = (await getProfile(address).catch(() => null))?.xUserId;
  if (current && (await xKeyUsedToday(current).catch(() => true))) {
    return NextResponse.json({ ok: false, error: "x_used_today" }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as { return?: XReturn };
  const state = newState(body.return === "page" ? "page" : "redirect");
  const { verifier, challenge } = pkcePair();
  try {
    await createLinkState(state, address, verifier, X_STATE_TTL_MS);
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
  const url = authorizeUrl({ clientId: process.env.X_CLIENT_ID!, redirectUri: redirectUri(quickAuthDomain(req)), state, challenge });
  return NextResponse.json({ ok: true, url }, { headers: { "Cache-Control": "no-store" } });
}
