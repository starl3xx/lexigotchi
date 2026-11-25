import { NextResponse } from "next/server";
import { erc20Abi } from "viem";
import { getPublicClient, readFeeBuckets, readLetterSupply, toWholeWord } from "@/lib/onchain/reads";
import { isSuiteDeployed, roleAddresses, wordTokenAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { scanWorld } from "@/lib/world";
import { WORD_COUNT } from "@/lib/dictionary";

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
  words?: { claimed: number; dictionary: number; uppercase: number; staked: number };
  /** Wallets holding at least one letter or word (the game's own contracts left out). */
  holders?: number;
}

const TTL_MS = 60_000;
let cached: { at: number; body: LivePayload } | null = null;
let inflight: Promise<LivePayload> | null = null;

async function build(): Promise<LivePayload> {
  const treasury = roleAddresses().treasury ?? null;
  const client = getPublicClient();
  const [buckets, supply, world, treasuryWei] = await Promise.all([
    readFeeBuckets(),
    readLetterSupply(),
    scanWorld(),
    treasury
      ? client.readContract({ address: wordTokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [treasury] })
      : Promise.resolve(null),
  ]);
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
      dictionary: WORD_COUNT,
      uppercase: world.words.filter((w) => w.raised >= 5).length,
      staked: world.words.filter((w) => w.staked).length,
    },
    holders: holders.size,
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
