import { NextResponse } from "next/server";
import { lookupProfile } from "@/lib/neynar";

export const runtime = "nodejs";
export const revalidate = 300;

/**
 * GET /api/auth/profile?fid=123 — username / avatar for a signed-in web player.
 *
 * Public and read-only by design: this returns nothing that isn't already public on Farcaster, and
 * it is not an auth boundary. It exists because a SIWF credential proves the FID but carries no
 * profile, which the mini-app SDK supplies for free inside a host.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("fid") ?? "";
  if (!/^\d+$/.test(raw)) return NextResponse.json({ ok: false, error: "bad_fid" }, { status: 400 });

  const profile = await lookupProfile(Number(raw));
  if (!profile) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, profile });
}
