import { NextResponse } from "next/server";
import { getProfile, isMissingTable, toView, unlinkX } from "@/lib/db/profiles";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST (wallet session required) — unlink X from this wallet. Works even with X switched off. */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const address = sessionAddress(req);
  if (!address) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  try {
    await unlinkX(address);
    return NextResponse.json({ ok: true, profile: toView(address, await getProfile(address)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
