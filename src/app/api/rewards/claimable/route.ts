import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { merkleEpochsAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import { isCampaignConfigured } from "@/lib/db/client";
import { rewardLeavesFor } from "@/lib/db/rewards";
import { epochKey, epochsOf, liveLeaves } from "@/lib/keeper/claimables";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — every unclaimed reward leaf whose payee is one of the given wallets.
 *
 * The keeper stores each epoch's full tree (proofs included) in the `reward_leaves` table before it
 * opens the epoch; this route is the read side: the union bag's wallets → their stored leaves →
 * only epochs the chain says are open with that same root → minus what the chain says is already
 * claimed. Proofs are public by design — a leaf pays its baked-in account no matter who submits it,
 * so serving them gates nothing. No database means no stored epochs: an empty answer, not an error.
 */
/** The union bag is the connected wallet plus a few linked ones; anything longer is not a player. */
const MAX_WALLETS = 20;

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const raw = new URL(req.url).searchParams.get("wallets") ?? "";
  const wallets = new Set<string>(
    raw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => isAddress(w, { strict: false })),
  );
  if (wallets.size === 0 || wallets.size > MAX_WALLETS) {
    return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });
  }

  // No contracts on this network (mainnet today) or no database: nothing can be stored or claimed.
  if (!isSuiteDeployed() || !isCampaignConfigured()) return NextResponse.json({ ok: true, claimables: [] });

  let rows: Awaited<ReturnType<typeof rewardLeavesFor>>;
  try {
    rows = await rewardLeavesFor(NETWORK.id, [...wallets]);
  } catch (err) {
    // Say so rather than answer "nothing to claim": an empty list here would hide real earnings.
    console.error("[rewards] reading stored leaves failed:", err);
    return NextResponse.json({ ok: false, error: "rewards_unavailable" }, { status: 503 });
  }
  if (rows.length === 0) return NextResponse.json({ ok: true, claimables: [] });

  const client = getPublicClient();
  const streamAddress = (stream: "yield" | "bounty") => addressOf(stream === "yield" ? "yieldDistributor" : "bounty");

  // Only epochs that are open on chain with the root these leaves were built for…
  const touched = epochsOf(rows);
  const states = (await client.multicall({
    allowFailure: false,
    contracts: touched.map((e) => ({
      address: streamAddress(e.stream),
      abi: merkleEpochsAbi,
      functionName: "epochs" as const,
      args: [BigInt(e.epochId)],
    })),
  })) as unknown as (readonly [`0x${string}`, bigint, bigint, bigint, boolean, bigint])[];
  const epochs = new Map(touched.map((e, i) => [epochKey(e.stream, e.epochId), { root: states[i][0], open: states[i][4] }]));
  const candidates = liveLeaves(rows, epochs);
  if (candidates.length === 0) return NextResponse.json({ ok: true, claimables: [] });

  // …minus what the chain says is already claimed.
  const claimed = (await client.multicall({
    allowFailure: false,
    contracts: candidates.map((c) => ({
      address: streamAddress(c.stream),
      abi: merkleEpochsAbi,
      functionName: "hasClaimed" as const,
      args: [BigInt(c.epochId), BigInt(c.tokenId)],
    })),
  })) as unknown as boolean[];

  return NextResponse.json({ ok: true, claimables: candidates.filter((_, i) => !claimed[i]) });
}
