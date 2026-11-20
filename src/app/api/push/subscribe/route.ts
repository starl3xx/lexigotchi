import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { clientIp } from "@/lib/auth/clientIp";
import { allow } from "@/lib/ratelimit";
import { isCampaignConfigured } from "@/lib/db/client";
import { saveWebPushSubscription } from "@/lib/db/webPush";
import { parseSubscriptionBody } from "@/lib/notify/webPushSubscription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — store a browser push subscription for a wallet.
 * Body: `{ address, subscription: PushSubscription.toJSON() }`. Optional `Authorization: Bearer`
 * Quick Auth token: when it verifies, the FID is stored beside the subscription (never a client
 * claim), so the daily reminder can read the FID's slot.
 *
 * NO WALLET SIGNATURE, deliberately. The messages describe onchain state that is public anyway
 * (whose staked words are getting hungry, who won the jackpot), so subscribing a browser to someone
 * else's wallet reveals nothing a block explorer doesn't, and the only browser it can ping is your
 * own. A signature prompt would cost every honest player a wallet popup to guard nothing. What IS
 * guarded: the endpoint must be a real push service (the server POSTs to it later, see
 * parseSubscriptionBody), a wallet keeps at most a few browsers, and calls are rate-limited.
 *
 * Dark until configured: without a VAPID public key there is nothing a browser could subscribe with.
 */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  if (!isCampaignConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (!(await allow("push", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const parsed = parseSubscriptionBody(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    await saveWebPushSubscription(parsed.sub, await getAuthedFid(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
