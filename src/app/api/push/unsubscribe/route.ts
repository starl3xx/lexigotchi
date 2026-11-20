import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { isCampaignConfigured } from "@/lib/db/client";
import { deleteWebPushSubscription } from "@/lib/db/webPush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — forget a browser. Body: `{ endpoint }`. Knowing the endpoint is the proof of ownership: it
 * is the push service's unguessable URL for that one browser. Deleting a row that doesn't exist is
 * a success, so a retry or a double tap is harmless.
 */
export async function POST(req: Request) {
  if (!isCampaignConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (!(await allow("push", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  let endpoint: unknown;
  try {
    endpoint = (await req.json())?.endpoint;
  } catch {
    /* handled below */
  }
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1024) {
    return NextResponse.json({ ok: false, error: "bad_endpoint" }, { status: 400 });
  }
  try {
    await deleteWebPushSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
