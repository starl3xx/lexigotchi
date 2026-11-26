/**
 * The game's public world, built once a minute and shared: who owns each claimed word, the
 * leaderboards, the faces of every wallet in either, today's yield, the draws, and the cards'
 * numbers (lib/world). `/api/world` serves it, and the back picture of a word's card reads it for
 * the word's facts (app/s/[text]/back), so the two never scan the chain twice.
 *
 * The scan reads every event since deploy, so one result serves everyone for a minute on a warm
 * instance (and `/api/world` adds the edge's minute on top). Callers on a cold instance share one
 * scan. A stale world beats none: when a scan fails, the last good one is served.
 */
import { loadLinkMap } from "@/lib/db/walletLinks";
import { buildLeaderboards, readYieldPot, scanDrawn, scanWorld, type BoardKey, type BoardRow } from "@/lib/world";
import { type PublicFace } from "@/lib/profile/rules";
import { playerFaces } from "@/lib/profile/faces";

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
  /** Secret words revealed so far → their draw number (1 = the first; not a date). */
  drawn?: Record<string, number>;
  /** Each live word's card number, by word: #1 is the first word anyone made (lib/cardFacts `madeOrder`). */
  numbers?: Record<string, number>;
}

/** The world as `/api/world` serves it, and what the server keeps beside it. */
export interface WorldNow {
  body: WorldResponse;
  /** Each word's own share of today's yield weight (0 for a word that earns nothing now): what
   *  "earns about X a day" takes out before it counts the word in (lib/cardFacts, earnsStaked). */
  weights: Record<string, number>;
  /** How many of each word's letters are UPPERCASE (0 to 5): the chain's, where a link's casing is only what the link says. */
  raised: Record<string, number>;
}

const TTL_MS = 60_000;
let cached: (WorldNow & { at: number }) | null = null;
let inflight: Promise<WorldNow> | null = null;

async function build(): Promise<WorldNow> {
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
  const numbers: Record<string, number> = {};
  for (const w of snap.words) {
    owners[w.word] = w.owner;
    if (w.number) numbers[w.word] = w.number;
  }
  const shown = new Set<string>(Object.values(owners));
  for (const rows of Object.values(boards)) for (const r of rows) shown.add(r.address);
  // Every wallet wears its account's face (lib/profile/faces.ts): the profile's X or chosen name,
  // and the first wallet's Farcaster face when the wallet has none of its own.
  const { profiles } = await playerFaces(shown);
  const yieldToday = pot === null ? undefined : { pot, weight: snap.yieldWeight };
  const raised = Object.fromEntries(snap.words.map((x) => [x.word, x.raised]));
  return { body: { ok: true, live: true, at: Date.now(), owners, boards, profiles, yieldToday, drawn, numbers }, weights: snap.weights, raised };
}

/**
 * The world now: the kept one while it is under a minute old, else a new scan (callers that arrive
 * together share it). When a scan fails, the last good world; it throws only when there has never
 * been one. Call it only where the suite is deployed.
 */
export async function worldNow(): Promise<WorldNow> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  try {
    inflight ??= build().finally(() => {
      inflight = null;
    });
    const world = await inflight;
    cached = { ...world, at: Date.now() };
    return cached;
  } catch (err) {
    console.error("[world] scan failed:", (err as Error).message?.slice(0, 200));
    if (cached) return cached;
    throw err;
  }
}

/** Tests only: forget the kept world. */
export function resetWorld() {
  cached = null;
  inflight = null;
}
