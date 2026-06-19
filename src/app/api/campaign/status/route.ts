import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { getCampaignStatus } from "@/lib/db/queries";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — the campaign state for the Quick-Auth-verified caller: `{ ok, added, shared, onboarded, eligible }`. */
export async function GET(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await allow("status", fid)))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  try {
    const status = await getCampaignStatus(fid);
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    console.error("[campaign/status] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
