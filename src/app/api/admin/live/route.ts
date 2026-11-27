import { NextResponse } from "next/server";
import { erc20Abi } from "viem";
import { getPublicClient, readFeeBuckets, readLetterSupply, toWholeWord } from "@/lib/onchain/reads";
import { isSuiteDeployed, roleAddresses, wordTokenAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { scanWorld } from "@/lib/world";
import { WORD_COUNT } from "@/lib/dictionary";
import { releasedWordCount } from "@/lib/sets/server";
import { freeLetterTotals } from "@/lib/db/freeClaims";
import { freeLetterBudget } from "@/lib/freeLetters";
import { DEFAULT_PARAMS } from "@/lib/params";
import { readClaimRevenue, type ClaimRevenue } from "@/lib/onchain/claimRevenue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — the live game, for the console's Pulse and Treasury tabs: the FeeRouter's three pots, the
 * treasury's $WORD, letters minted against their caps, words claimed against the dictionary, and how
 * many wallets hold anything. Public chain state only (the same class as /api/world), so it is open
 * and edge-cached for a minute. Amounts are whole $WORD; the console prices them at the live peg.
 */
export interface LivePayload {
  ok: true;
  live: boolean;
  at?: number;
  network?: { id: number; name: string; isTestnet: boolean };
  buckets?: { pool: number; jackpot: number; bounty: number };
  treasury?: { address: string; word: number } | null;
  letters?: { minted: number; cap: number };
  /**
   * `dictionary` is the words the game offers NOW (the whole dictionary less every word held back
   * in a reserved set); `held` is how many are held back. Counts only: never which words.
   */
  words?: { claimed: number; dictionary: number; held: number; uppercase: number; staked: number };
  /** Wallets holding at least one letter or word (the game's own contracts left out). */
  holders?: number;
  /**
   * The free-letter ledger (decisions.md #21; aggregate counts from `free_claims`, no player data):
   * letters signed and not given back, the budget, the daily limit, and the stop. Null before
   * migration 0015 or when the database can't be read.
   */
  freeLetters?: {
    signed: number;
    budget: number;
    remaining: number;
    packs: number;
    dailies: number;
    /** Signed but not settled yet (their vouchers may still lapse and give letters back). */
    pending: number;
    dailyLimit: number;
    stopFraction: number;
  } | null;
  /**
   * Claim fees paid, by the claimed word's tier (decisions.md #60; Words' ClaimFeePaid events since
   * deploy). Null on a Words without the claim fee by rarity, or when the events can't be read.
   */
  claimRevenue?: ClaimRevenue | null;
}

const TTL_MS = 60_000;
let cached: { at: number; body: LivePayload } | null = null;
let inflight: Promise<LivePayload> | null = null;

async function build(): Promise<LivePayload> {
  const treasury = roleAddresses().treasury ?? null;
  const client = getPublicClient();
  const [buckets, supply, world, treasuryWei, ledger, released, claimRevenue] = await Promise.all([
    readFeeBuckets(),
    readLetterSupply(),
    scanWorld(),
    treasury
      ? client.readContract({ address: wordTokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [treasury] })
      : Promise.resolve(null),
    freeLetterTotals(NETWORK.id).catch(() => null),
    releasedWordCount(),
    readClaimRevenue().catch(() => null),
  ]);
  const budget = freeLetterBudget();
  const holders = new Set<string>([...Object.keys(world.letters), ...world.words.map((w) => w.owner)]);
  return {
    ok: true,
    live: true,
    at: Date.now(),
    network: { id: NETWORK.id, name: NETWORK.name, isTestnet: NETWORK.isTestnet },
    buckets,
    treasury: treasury && treasuryWei != null ? { address: treasury, word: toWholeWord(treasuryWei) } : null,
    letters: { minted: supply.minted.reduce((a, b) => a + b, 0), cap: supply.caps.reduce((a, b) => a + b, 0) },
    words: {
      claimed: world.words.length,
      dictionary: released,
      held: WORD_COUNT - released,
      uppercase: world.words.filter((w) => w.raised >= 5).length,
      staked: world.words.filter((w) => w.staked).length,
    },
    holders: holders.size,
    freeLetters: ledger
      ? {
          ...ledger,
          budget,
          remaining: Math.max(0, budget - ledger.signed),
          dailyLimit: DEFAULT_PARAMS.freeLetters.freeDailyLimit,
          stopFraction: DEFAULT_PARAMS.freeLetters.freeStopClaimedFraction,
        }
      : null,
    claimRevenue,
  };
}

export async function GET() {
  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, live: false } satisfies LivePayload);
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
    console.error("[admin/live] failed:", (err as Error).message?.slice(0, 200));
    if (cached) return NextResponse.json(cached.body, { headers });
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
