import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getProfile, isMissingTable, toPublicView } from "@/lib/db/profiles";
import { profilesEnabled } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?address=0x…` — a wallet's PUBLIC profile: its linked X account and which account names it.
 * Never the email. Public by design, so a returning player's name, picture, and X daily show
 * without a signature; edits still need the wallet session.
 */
export async function GET(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  try {
    const profile = toPublicView(address, await getProfile(address));
    return NextResponse.json({ ok: true, profile }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
