import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { dailyTargets, isDailyDue, webPushDailyKey, type DailyState } from "@/lib/notify/triggers";
import { dailyReady } from "@/lib/notify/templates";
import { sendNotification } from "@/lib/notify/send";
import { sendWebPush, type WebPushResult } from "@/lib/notify/webPush";
import { allWebPushSubscriptions } from "@/lib/db/webPush";
import { verifiedDailyKey } from "@/lib/onchain/verifications";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { maybeAddressOf } from "@/lib/onchain/addresses";
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
    // Who could be reminded at all, BEFORE touching the chain: with nobody to remind, return without
    // reading a contract (production runs the mock today, and its network has no deployment).
    // A missing browser table (migration not run) reads as no subscriptions, never as a failure.
    const [fids, subs] = await Promise.all([
      notifiableFids(),
      allWebPushSubscriptions().catch((err) => {
        console.error("[cron/notify-daily] couldn't read browser subscriptions:", err instanceof Error ? err.message : err);
        return [];
      }),
    ]);
    if (fids.length === 0 && subs.length === 0) return NextResponse.json({ ok: true, audience: 0, sent: 0 });
    const letters = maybeAddressOf("letters");
    if (!letters) return NextResponse.json({ ok: true, skipped: "no_deployment", audience: fids.length });

    const client = getPublicClient();
    const readDailyUsed = async (keys: readonly bigint[]) =>
      keys.length === 0
        ? []
        : client.multicall({
            allowFailure: false,
            contracts: keys.map((key) => ({
              address: letters,
              abi: lettersAbi,
              functionName: "dailyUsed" as const,
              args: [key],
            })),
          });

    // CHAIN time, not wall clock. `dailyUsed` stores `block.timestamp / 1 days + 1`, and the mint
    // compares against that same clock — so deriving the day from Date.now() lets the two disagree
    // whenever the chain's notion of the day has rolled and ours hasn't (or vice versa). The result
    // would be telling players their daily is ready when the contract would still revert, or
    // skipping players who genuinely can pull. Every other day-comparison in the codebase
    // (readDayState, the mint routes) reads chain time for exactly this reason.
    const day = Math.floor((await readChainTime()) / 86_400);

    // ── Farcaster ────────────────────────────────────────────────────────────────────────────
    let targets: number[] = [];
    let result: Awaited<ReturnType<typeof sendNotification>> | undefined;
    if (fids.length > 0) {
      const used = await readDailyUsed(fids.map((fid) => BigInt(fid)));
      const states: DailyState[] = fids.map((fid, i) => ({ fid, lastDailyDayPlusOne: Number(used[i]) }));
      targets = dailyTargets(states, day);
      // An empty target list is a legitimate outcome (everyone already played), NOT a reason to
      // broadcast. sendNotification refuses an empty audience; skipping the call says so plainly.
      if (targets.length > 0) result = await sendNotification({ ...dailyReady(day), targetFids: targets });
    }

    // ── Browsers ─────────────────────────────────────────────────────────────────────────────
    // Each subscription reads its own daily slot (the FID's, or the Coinbase-verified wallet's);
    // FIDs the Farcaster channel already reminds are skipped.
    let browserTargets = 0;
    let browserResult: WebPushResult | undefined;
    const farcasterFids = new Set(fids);
    const keyed = subs
      .map((sub) => ({ sub, key: webPushDailyKey(sub, farcasterFids, verifiedDailyKey) }))
      .filter((k): k is { sub: (typeof subs)[number]; key: bigint } => k.key !== null);
    if (keyed.length > 0) {
      const uniqueKeys = [...new Set(keyed.map((k) => k.key))];
      const used = await readDailyUsed(uniqueKeys);
      const usedByKey = new Map(uniqueKeys.map((k, i) => [k, Number(used[i])]));
      const due = keyed.filter((k) => isDailyDue(usedByKey.get(k.key) ?? 0, day)).map((k) => k.sub);
      browserTargets = due.length;
      if (due.length > 0) browserResult = await sendWebPush(due, dailyReady(day));
    }

    const summary = {
      ok: true,
      audience: fids.length,
      targets: targets.length,
      result,
      browsers: { subscriptions: subs.length, targets: browserTargets, result: browserResult },
    };
    console.log("[cron/notify-daily]", summary);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/notify-daily] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
