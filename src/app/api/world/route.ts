import { NextResponse } from "next/server";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { worldNow, type WorldResponse } from "@/lib/worldSnapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — the game's public world: who owns each claimed word, the leaderboards, and the Farcaster
 * name and picture of every wallet in either (lib/world). Public data only: the chain already says
 * all of it, and Farcaster profiles are public by design.
 *
 * The scan reads every event since deploy, so one result serves everyone for a minute: in memory
 * on a warm instance (lib/worldSnapshot, which the back picture of a word's card reads too), and
 * at the edge (s-maxage) across instances. Concurrent callers on a cold instance share one scan.
 */
export type { WorldResponse } from "@/lib/worldSnapshot";

export async function GET() {
  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, live: false } satisfies WorldResponse);
  const headers = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
  try {
    // A stale world beats none: worldNow serves the last good one when a scan fails.
    return NextResponse.json((await worldNow()).body, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "world_unavailable" }, { status: 503 });
  }
}
