import { NextResponse } from "next/server";
import { loadLinkMap } from "@/lib/db/walletLinks";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { buildLeaderboards, readYieldPot, scanDrawn, scanWorld, type BoardKey, type BoardRow } from "@/lib/world";
import { type PublicFace } from "@/lib/profile/rules";
import { playerFaces } from "@/lib/profile/faces";

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
  profiles?: Record<string, PublicFace>;
  /**
   * Today's yield: the pot (whole $WORD) and the total weight sharing it, for "earns about X a day"
   * (lib/wordCost.ts dailyEarnEstimate). Absent when either read failed.
   */
  yieldToday?: { pot: number; weight: number };
  /** Secret words revealed so far → their UTC day. A revealed word is never drawn again. */
  drawn?: Record<string, number>;
}

const TTL_MS = 60_000;
let cached: { at: number; body: WorldResponse } | null = null;
let inflight: Promise<WorldResponse> | null = null;

async function build(): Promise<WorldResponse> {
  // The pot and the draws are extras for the Market: a failed read leaves them out, never the world.
  const [snap, links, pot, drawn] = await Promise.all([
    scanWorld(),
    loadLinkMap(),
    readYieldPot().catch(() => null),
    scanDrawn().catch(() => undefined),
  ]);
  // One row per player: linked wallets count toward their account (loadLinkMap never throws).
  const boards = buildLeaderboards(snap, 25, links.accountOf);
  const owners: Record<string, string> = {};
  for (const w of snap.words) owners[w.word] = w.owner;
  const shown = new Set<string>(Object.values(owners));
  for (const rows of Object.values(boards)) for (const r of rows) shown.add(r.address);
  // Every wallet wears its account's face (lib/profile/faces.ts): the profile's X or chosen name,
  // and the first wallet's Farcaster face when the wallet has none of its own.
  const { profiles } = await playerFaces(shown);
  const yieldToday = pot === null ? undefined : { pot, weight: snap.yieldWeight };
  return { ok: true, live: true, at: Date.now(), owners, boards, profiles, yieldToday, drawn };
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
