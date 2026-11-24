import { NextResponse } from "next/server";
import { getProfile, isMissingTable, toView, unlinkX } from "@/lib/db/profiles";
import { xKeyUsedToday } from "@/lib/onchain/dailyIdentity";
import { profilesEnabled, sessionAddress } from "@/lib/profile/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST (wallet session required) — unlink X from this wallet. Works even with X switched off. */
export async function POST(req: Request) {
  if (!profilesEnabled()) return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  const address = sessionAddress(req);
  if (!address) return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
  try {
    // An X account that took today's letter stays linked until tomorrow (dailyIdentity.ts).
    const current = await getProfile(address);
    if (current?.xUserId) {
      const usedToday = await xKeyUsedToday(current.xUserId).catch(() => null);
      if (usedToday === null) return NextResponse.json({ ok: false, error: "cant_check" }, { status: 503 });
      if (usedToday) return NextResponse.json({ ok: false, error: "x_used_today" }, { status: 409 });
    }
    await unlinkX(address);
    return NextResponse.json({ ok: true, profile: toView(address, await getProfile(address)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    throw err;
  }
}
