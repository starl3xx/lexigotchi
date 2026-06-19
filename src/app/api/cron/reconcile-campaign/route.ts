import { NextResponse } from "next/server";
import { reconcileShares } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // sequential Neynar checks; Vercel Pro allows up to 300s

/**
 * Launch-reconcile cron — re-verifies recent share-attempters whose cast proof missed the Neynar
 * indexing window at share time, so nobody who actually shared gets dropped from eligibility.
 *
 * Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}` to scheduled invocations when the
 * env var is set (see vercel.json). The route verifies it and FAILS CLOSED in production if the
 * secret is missing. Scheduled hourly; cheap no-op once the attempter population drains.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/reconcile-campaign] CRON_SECRET not set — refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  try {
    const result = await reconcileShares();
    console.log("[cron/reconcile-campaign]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/reconcile-campaign] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
