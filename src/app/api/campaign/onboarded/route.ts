import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { markOnboarded } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST — record that the Quick-Auth-verified caller finished onboarding (write-once). */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    await markOnboarded(fid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[campaign/onboarded] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
