import { NextResponse } from "next/server";
import { notifiableFids } from "@/lib/db/queries";
import { dailyTargets, isDailyDue, type DailyState } from "@/lib/notify/triggers";
import { dailyReady } from "@/lib/notify/templates";
import { sendNotification } from "@/lib/notify/send";
import { sendWebPush, type WebPushResult } from "@/lib/notify/webPush";
import { allWebPushSubscriptions } from "@/lib/db/webPush";
import { emailRecipients, markEmailSent } from "@/lib/db/profiles";
import { loadLinkMap } from "@/lib/db/walletLinks";
import { relatedDailyKeysMany } from "@/lib/onchain/dailyIdentity";
import { emailEnabled, reminderEmail, sendEmails } from "@/lib/notify/email";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { maybeAddressOf } from "@/lib/onchain/addresses";
import { lettersAbi } from "@/lib/onchain/abis";
import { countingDailyGrants, fidLedgerAccount } from "@/lib/db/freeClaims";
import { finishedProfiles } from "@/lib/freeLetters";
import { freeGrantStop } from "@/lib/onchain/freeLedger";
import { NETWORK } from "@/lib/onchain/network";
import { DEFAULT_PARAMS } from "@/lib/params";

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
    // Email has its own audience (wallets that opted in), so it doesn't wait on the other two
    // (Bugbot on #139: wallet-only email players were skipped whenever nobody else was).
    if (fids.length === 0 && subs.length === 0 && !emailEnabled()) return NextResponse.json({ ok: true, audience: 0, sent: 0 });
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

    // The free daily letters are 10 per profile, from one budget, and end near a full dictionary
    // (decisions.md #21). Once free letters stop for everyone, nobody is told one is waiting; a
    // profile that took all 10 is skipped below. A failed ledger read reminds as before.
    const stopped = await freeGrantStop(NETWORK.id, 1).catch(() => null);
    if (stopped) return NextResponse.json({ ok: true, skipped: `free_letters_${stopped}`, audience: fids.length });
    // Linked wallets: a reminder reads every key the player's ACCOUNT could pull under, the same
    // walk the daily route refuses on (relatedDailyKeysMany), so a pull under another linked
    // wallet's Coinbase key, FID, or X counts as today's. loadLinkMap never throws.
    const links = await loadLinkMap();
    // Profiles that took all 10, with every ledger account, key, and wallet they used, so each
    // channel matches on what it knows: Farcaster by keys, browsers and email by account, keys, or
    // wallets (lib/freeLetters.ts finishedProfiles; Bugbot on #199). A failed read finishes nobody.
    const finished = finishedProfiles(await countingDailyGrants(NETWORK.id), (w) => links.accountOf(w), DEFAULT_PARAMS.freeLetters.freeDailyLimit);
    const isFinished = (accounts: readonly string[], keys: readonly bigint[], wallets: readonly string[]) =>
      accounts.some((a) => finished.accounts.has(a.toLowerCase())) ||
      keys.some((k) => finished.keys.has(k.toString())) ||
      wallets.some((w) => finished.wallets.has(w.toLowerCase()));

    // ── Farcaster ────────────────────────────────────────────────────────────────────────────
    let targets: number[] = [];
    let result: Awaited<ReturnType<typeof sendNotification>> | undefined;
    if (fids.length > 0) {
      const used = await readDailyUsed(fids.map((fid) => BigInt(fid)));
      const states: DailyState[] = fids.map((fid, i) => ({ fid, lastDailyDayPlusOne: Number(used[i]) }));
      const due = dailyTargets(states, day);
      // A FID's finished profile may have claimed under a Coinbase or X key: walk the FID's keys.
      const dueKeys = finished.keys.size > 0 ? await relatedDailyKeysMany(due.map((f) => ({ fid: f, wallets: [] }))) : due.map(() => []);
      targets = due.filter((f, i) => !isFinished([fidLedgerAccount(f)], [BigInt(f), ...dueKeys[i]], []));
      // An empty target list is a legitimate outcome (everyone already played), NOT a reason to
      // broadcast. sendNotification refuses an empty audience; skipping the call says so plainly.
      if (targets.length > 0) result = await sendNotification({ ...dailyReady(day), targetFids: targets });
    }

    // ── Browsers ─────────────────────────────────────────────────────────────────────────────
    // Each subscription reads its player's daily slots; FIDs the Farcaster channel already reminds
    // are skipped. A failed lookup adds fewer keys: at worst one extra reminder, never a missed one.
    let browserTargets = 0;
    let browserResult: WebPushResult | undefined;
    const farcasterFids = new Set(fids);
    const open = subs.filter((sub) => !(sub.fid !== null && farcasterFids.has(sub.fid)));
    const subKeys = await relatedDailyKeysMany(
      open.map((sub) => ({ fid: sub.fid, wallets: links.walletsOf(links.accountOf(sub.address)) })),
    );
    const keyed = open.map((sub, i) => ({ sub, keys: subKeys[i] })).filter((k) => k.keys.length > 0);
    if (keyed.length > 0) {
      const uniqueKeys = [...new Set(keyed.flatMap((k) => k.keys))];
      const used = await readDailyUsed(uniqueKeys);
      const usedByKey = new Map(uniqueKeys.map((k, i) => [k, Number(used[i])]));
      // dailyUsed holds day+1, so the largest value is the most recent pull of any of the keys.
      const lastPull = (keys: bigint[]) => Math.max(...keys.map((key) => usedByKey.get(key) ?? 0));
      const due = keyed
        .filter((k) => {
          const account = links.accountOf(k.sub.address);
          return !isFinished([account], k.keys, links.walletsOf(account)) && isDailyDue(lastPull(k.keys), day);
        })
        .map((k) => k.sub);
      browserTargets = due.length;
      if (due.length > 0) browserResult = await sendWebPush(due, dailyReady(day));
    }

    // ── Email ────────────────────────────────────────────────────────────────────────────────
    // Players who confirmed an email and kept reminders on. Each reads its wallet's Coinbase and X
    // slots, the latest pull deciding (one letter a day). Opted in, so Farcaster or a browser
    // reaching the same player doesn't skip it. Any failure here leaves the other channels alone.
    let emailTargets = 0;
    let emailResult: { sent: number; failed: number } | undefined;
    if (emailEnabled()) {
      try {
        const recips = await emailRecipients();
        // Every slot the player could pull on, across the account (an email row is keyed by the
        // account): the FIDs that verified any of its wallets, those FIDs' wallets, every Coinbase
        // key, and the X keys (Bugbot on #139: without the FID, a Farcaster-only player never got
        // the email, and one who pulled on the FID could be told a letter was waiting).
        const recipKeys = await relatedDailyKeysMany(recips.map((r) => ({ fid: null, wallets: links.walletsOf(r.address) })));
        const keysOf = new Map(recips.map((r, i) => [r.address, recipKeys[i]]));
        const uniqueKeys = [...new Set(recipKeys.flat())];
        const used = await readDailyUsed(uniqueKeys);
        const usedByKey = new Map(uniqueKeys.map((k, i) => [k, Number(used[i])]));
        // Skip anyone this day's reminder already reached: a retried cron must not email twice (Bugbot on #139).
        const due = recips.filter(
          (r) =>
            r.emailDailyDay !== day &&
            !isFinished([r.address], keysOf.get(r.address) ?? [], links.walletsOf(r.address)) &&
            isDailyDue(Math.max(0, ...(keysOf.get(r.address) ?? []).map((k) => usedByKey.get(k) ?? 0)), day),
        );
        emailTargets = due.length;
        const messages = due.flatMap((r) => reminderEmail(r.email, r.address, dailyReady(day)) ?? []);
        if (messages.length > 0)
          emailResult = await sendEmails(messages, {
            idempotency: `daily-${day}`,
            onSent: (batch) => markEmailSent("daily", batch.flatMap((m) => (m.address ? [m.address] : [])), day),
          });
      } catch (err) {
        console.error("[cron/notify-daily] email pass failed:", String((err as Error)?.message ?? err).slice(0, 120));
      }
    }

    const summary = {
      ok: true,
      audience: fids.length,
      targets: targets.length,
      result,
      browsers: { subscriptions: subs.length, targets: browserTargets, result: browserResult },
      email: { targets: emailTargets, result: emailResult },
    };
    console.log("[cron/notify-daily]", summary);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/notify-daily] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
