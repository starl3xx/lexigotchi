import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { LIMITS } from "@/lib/notify/limits"; // NOT ./send — that module throws when armed without a key

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only status for the operator console's Notifications tab.
 *
 * DELIBERATELY READ-ONLY, and this is the important part. The other admin routes are unauthenticated
 * on the server on purpose (`src/lib/admin/auth.ts`): the console's on-chain operations are
 * transaction BUILDERS, so the real boundary is the owner key's signature, and the route gate is
 * about discoverability rather than secrecy.
 *
 * A notification send has NO such backstop. There is no signature to forge-proof it — the endpoint
 * itself would be the whole authority, and anyone who found the URL could push to every player, once,
 * irreversibly. So there is no send endpoint. Sending lives in the keeper (`--notify`, `--announce`),
 * behind shell access and the deploy's env, and in the cron behind CRON_SECRET.
 *
 * What this returns is config booleans and a headcount — the same class of non-secret as /pulse.
 * It never returns the API key, a notification token, or any FID.
 */
export async function GET() {
  const isProd = process.env.NODE_ENV === "production";
  const flagOn = process.env.NOTIFICATIONS_ENABLED === "true";
  const hasKey = Boolean(process.env.NEYNAR_API_KEY);

  let audience: number | null = null;
  let audienceError: string | null = null;
  try {
    audience = (await notifiableFids()).length;
  } catch (err) {
    // A DB outage must not blank the whole tab — the arming status is the part that matters.
    audienceError = err instanceof Error ? err.message.slice(0, 120) : "unavailable";
  }

  const blockers: string[] = [];
  if (!isProd) blockers.push("not a production deployment");
  if (!flagOn) blockers.push("NOTIFICATIONS_ENABLED is not \"true\"");
  if (!hasKey) blockers.push("NEYNAR_API_KEY is not set");

  return NextResponse.json({
    armed: blockers.length === 0,
    blockers,
    checks: { isProd, flagOn, hasKey },
    audience,
    audienceError,
    limits: LIMITS,
  });
}
