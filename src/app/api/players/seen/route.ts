import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { isCampaignConfigured } from "@/lib/db/client";
import { isMissingTable } from "@/lib/db/profiles";
import { recordSighting } from "@/lib/db/sightings";
import { parseSighting } from "@/lib/sightings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — "this wallet is connected to the game". Body: `{ address, via: "web" | "farcaster" }`.
 * The game sends it once per wallet per UTC day (useWalletSighting), so the operator console can
 * count wallets that connect and then do nothing onchain. An optional Quick Auth token stores the
 * verified FID beside the wallet; a FID is never taken from the body.
 *
 * UNSIGNED, on purpose: a signature would be a wallet popup for every visitor just to be counted.
 * So anyone can add an address, and the console says the count is unverified. Rate-limited by IP.
 * The response says nothing about the wallet, so the route can't be used to look anyone up.
 *
 * Dark until migration 0012: a missing table answers not_configured and the game stays quiet.
 */
export async function POST(req: Request) {
  if (!isCampaignConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (!(await allow("seen", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const parsed = parseSighting(body);
  if (!parsed) return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });

  try {
    await recordSighting({ ...parsed, fid: await getAuthedFid(req) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    console.error("[players/seen] error:", (err as Error).message?.slice(0, 200));
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
