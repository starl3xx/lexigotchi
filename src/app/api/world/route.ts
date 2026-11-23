import { NextResponse } from "next/server";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { buildLeaderboards, scanWorld, type BoardKey, type BoardRow } from "@/lib/world";
import { profilesByAddress, type PublicProfile } from "@/lib/neynar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — the game's public world: who owns each claimed word, the leaderboards, and the Farcaster
 * name and picture of every wallet in either (lib/world). Public data only: the chain already says
 * all of it, and Farcaster profiles are public by design.
 *
 * The scan reads every event since deploy, so one result serves everyone for a minute: in memory
 * on a warm instance, and at the edge (s-maxage) across instances. Concurrent callers on a cold
 * instance share one scan.
 */
export interface WorldResponse {
  ok: true;
  /** False until this network's suite is deployed: the practice game has no shared world. */
  live: boolean;
  at?: number;
  /** UPPERCASE word → its beneficial owner (lowercase address). */
  owners?: Record<string, string>;
  boards?: Record<BoardKey, BoardRow[]>;
  profiles?: Record<string, PublicProfile>;
}

const TTL_MS = 60_000;
let cached: { at: number; body: WorldResponse } | null = null;
let inflight: Promise<WorldResponse> | null = null;

async function build(): Promise<WorldResponse> {
  const snap = await scanWorld();
  const boards = buildLeaderboards(snap);
  const owners: Record<string, string> = {};
  for (const w of snap.words) owners[w.word] = w.owner;
  const shown = new Set<string>(Object.values(owners));
  for (const rows of Object.values(boards)) for (const r of rows) shown.add(r.address);
  const profiles = await profilesByAddress([...shown]);
  return { ok: true, live: true, at: Date.now(), owners, boards, profiles };
}

export async function GET() {
  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, live: false } satisfies WorldResponse);
  const headers = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.body, { headers });
  try {
    inflight ??= build().finally(() => {
      inflight = null;
    });
    const body = await inflight;
    cached = { at: Date.now(), body };
    return NextResponse.json(body, { headers });
  } catch (err) {
    console.error("[world] scan failed:", (err as Error).message?.slice(0, 200));
    // A stale world beats none: serve the last good one if there is one.
    if (cached) return NextResponse.json(cached.body, { headers });
    return NextResponse.json({ ok: false, error: "world_unavailable" }, { status: 503 });
  }
}
