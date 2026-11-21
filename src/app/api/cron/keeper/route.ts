import { NextResponse } from "next/server";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { createKeeper, jobsFrom, type KeeperJob } from "@/lib/keeper/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Jobs run one after another and each waits for its receipt; the word scan reads every claim since
// deploy. Vercel Pro allows 300s without extra configuration.
export const maxDuration = 300;

/**
 * GET — the daily keeper pass, scheduled by vercel.json (00:05 UTC, just after the chain day turns).
 *
 * Runs the jobs named in KEEPER_JOBS (default "resolve,yield,notify") strictly in order: resolve
 * first because it is the time-sensitive one, notify last so it sees the fresh state. One job
 * failing does not skip the rest; the response lists each job's result.
 *
 * Bounty and achievements are opt-in (add them to KEEPER_JOBS): bounty is OFF at launch
 * (decisions.md #11), and achievements need the network's EAS schema registered first.
 *
 * Needs KEEPER_PRIVATE_KEY and the answer schedule (ANSWER_CHAIN_SEED + ANSWER_CHAIN_DAYS) in the
 * host's secrets. With no deployment on this network, or no keeper key, it does nothing.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; fails closed in production without it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/keeper] CRON_SECRET not set — refusing in production");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
  }

  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, skipped: "no_deployment" });
  if (!process.env.KEEPER_PRIVATE_KEY) return NextResponse.json({ ok: true, skipped: "no_keeper_key" });

  let jobs: KeeperJob[];
  try {
    jobs = jobsFrom(process.env.KEEPER_JOBS);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  const keeper = createKeeper({ dry: false });
  const results: { job: KeeperJob; ok: boolean; error?: string }[] = [];
  for (const job of jobs) {
    try {
      await keeper.run(job);
      results.push({ job, ok: true });
    } catch (err) {
      // Each job redacts its own secrets (resolve never puts the word in an error); trim the rest.
      const error = String((err as Error).message ?? err).slice(0, 300);
      console.error(`[cron/keeper] ${job} failed: ${error}`);
      results.push({ job, ok: false, error });
    }
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
