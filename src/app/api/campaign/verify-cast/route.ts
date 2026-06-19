import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { verifyShareCast } from "@/lib/neynar";
import { getCampaignStatus, recordCastProof } from "@/lib/db/queries";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST — server-verify (via Neynar) that the caller shared a cast embedding our domain, and record
 *  the proof. Returns `{ ok, shared }`. Idempotent: a proof already on file short-circuits Neynar. */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await allow("verify-cast", fid)))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  try {
    const status = await getCampaignStatus(fid);
    if (status.shared) return NextResponse.json({ ok: true, shared: true }); // already proven

    const cast = await verifyShareCast(fid);
    if (!cast) return NextResponse.json({ ok: true, shared: false }); // not found yet (Neynar lag / no cast)

    await recordCastProof(fid, cast.castHash, cast.castUrl);
    return NextResponse.json({ ok: true, shared: true });
  } catch (err) {
    console.error("[campaign/verify-cast] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
