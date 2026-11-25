import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { reminderAudience } from "@/lib/db/adminReads";
import { isCampaignConfigured } from "@/lib/db/client";
import { emailSwitch, farcasterNotifySwitch, webPushSwitch, type Switch } from "@/lib/admin/switches";
import { LIMITS } from "@/lib/notify/limits"; // NOT ./send — that module throws when armed without a key

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only status for the operator console's Notifications tab: each reminder channel's switch and
 * how many players it would reach.
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
 * What this returns is config booleans, setting NAMES, and headcounts — the same class of non-secret
 * as /pulse. It never returns the API key, a notification token, an email, an endpoint, or any FID.
 */
export interface ChannelStatus extends Switch {
  /** Players this channel reaches now, or null when the count couldn't be read. */
  audience: number | null;
  /** The count as a phrase ("1 wallet (2 browsers) subscribed"), or why there is none. */
  audienceNote: string;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

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
  const reach = isCampaignConfigured() ? await reminderAudience().catch(() => null) : null;

  const blockers: string[] = [];
  if (!isProd) blockers.push("not a production deployment");
  if (!flagOn) blockers.push("NOTIFICATIONS_ENABLED is not \"true\"");
  if (!hasKey) blockers.push("NEYNAR_API_KEY is not set");

  const push = webPushSwitch();
  const channels: ChannelStatus[] = [
    {
      ...farcasterNotifySwitch(),
      audience,
      audienceNote:
        audience == null ? "audience not readable" : `${n(audience, "player", "players")} added the mini app with notifications on`,
    },
    {
      ...push,
      audience: reach && !reach.missing ? reach.value.pushWallets : null,
      audienceNote:
        reach && !reach.missing
          ? `${n(reach.value.pushWallets, "wallet", "wallets")} (${n(reach.value.pushBrowsers, "browser", "browsers")}) subscribed`
          : "subscriptions table not readable",
    },
    {
      ...emailSwitch(),
      audience: reach && !reach.missing ? reach.value.emailOptedIn : null,
      audienceNote:
        reach && !reach.missing
          ? `${n(reach.value.emailOptedIn, "confirmed email", "confirmed emails")} with reminders on`
          : "profiles table not readable",
    },
  ];

  return NextResponse.json({
    armed: blockers.length === 0,
    blockers,
    checks: { isProd, flagOn, hasKey },
    audience,
    audienceError,
    channels,
    limits: LIMITS,
  });
}
