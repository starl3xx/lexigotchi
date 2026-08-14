import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { dailyTargets, type DailyState } from "@/lib/notify/triggers";
import { dailyReady } from "@/lib/notify/templates";
import { sendNotification } from "@/lib/notify/send";
import { getPublicClient } from "@/lib/onchain/reads";
import { addressOf } from "@/lib/onchain/addresses";
import { lettersAbi } from "@/lib/onchain/abis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily-reset ping — "your free daily letter is ready".
 *
 * The highest-volume notification the game has, so it is the most heavily gated. Eligibility is
 * read FROM THE CHAIN (`Letters.dailyUsed`), never from our DB: it is the same mapping the mint
 * itself checks, so this cannot tell someone their daily is waiting when the contract would reject
 * the pull. `dailyTargets` applies the rest (never-pulled and drifted-away players are excluded —
 * see its NatSpec for why).
 *
 * Schedule it a little after the UTC day boundary the contracts use. Safe to retry: the day-keyed
 * `notificationId` makes a second run within 24h a no-op at the client.
 *
 * Auth mirrors reconcile-campaign: Vercel's `Authorization: Bearer ${CRON_SECRET}`, failing CLOSED
 * in production when the secret is absent.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/notify-daily] CRON_SECRET not set — refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  try {
    const fids = await notifiableFids();
    if (fids.length === 0) return NextResponse.json({ ok: true, audience: 0, sent: 0 });

    const client = getPublicClient();
    const letters = addressOf("letters");
    const used = await client.multicall({
      allowFailure: false,
      contracts: fids.map((fid) => ({
        address: letters,
        abi: lettersAbi,
        functionName: "dailyUsed" as const,
        args: [BigInt(fid)],
      })),
    });

    const day = Math.floor(Date.now() / 86_400_000);
    const states: DailyState[] = fids.map((fid, i) => ({
      fid,
      lastDailyDayPlusOne: Number(used[i]),
    }));
    const targets = dailyTargets(states, day);

    // An empty target list is a legitimate outcome (everyone already played), NOT a reason to
    // broadcast. sendNotification refuses an empty audience, but returning early says so plainly.
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, audience: fids.length, targets: 0, sent: 0 });
    }

    const result = await sendNotification({ ...dailyReady(day), targetFids: targets });
    console.log("[cron/notify-daily]", { audience: fids.length, targets: targets.length, result });
    return NextResponse.json({ ok: true, audience: fids.length, targets: targets.length, result });
  } catch (err) {
    console.error("[cron/notify-daily] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
