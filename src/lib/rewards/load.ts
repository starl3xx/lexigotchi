/**
 * A player's reward shares, read from the stored trees and checked against the chain (server only).
 *
 * The keeper stores each epoch's whole tree (proofs included) in `reward_leaves` before it opens
 * the epoch. A stored share counts only if its epoch is open on chain with that same root
 * (claimables.liveLeaves); the chain then says whether it was paid (hasClaimed) and whether its
 * epoch has anything left (claimed vs funded). Shared by /api/rewards/claimable (what's left to
 * collect, with proofs) and /api/rewards/earnings (what the player's words have earned).
 */
import { addressOf } from "@/lib/onchain/addresses";
import { merkleEpochsAbi } from "@/lib/onchain/abis";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import { rewardLeavesFor } from "@/lib/db/rewards";
import { epochKey, epochsOf, liveLeaves, shareStatuses, type EpochState, type ShareStatus } from "@/lib/keeper/claimables";
import { latestOpenDay } from "./earnings";

type EpochTuple = readonly [`0x${string}`, bigint, bigint, bigint, boolean, bigint];

const streamAddress = (stream: "yield" | "bounty") => addressOf(stream === "yield" ? "yieldDistributor" : "bounty");

/** Every live share paying one of these wallets, with paid/dead from the chain. */
export async function loadShares(wallets: readonly string[]): Promise<ShareStatus[]> {
  const rows = await rewardLeavesFor(NETWORK.id, wallets);
  if (rows.length === 0) return [];
  const client = getPublicClient();

  const touched = epochsOf(rows);
  const states = (await client.multicall({
    allowFailure: false,
    contracts: touched.map((e) => ({
      address: streamAddress(e.stream),
      abi: merkleEpochsAbi,
      functionName: "epochs" as const,
      args: [BigInt(e.epochId)],
    })),
  })) as unknown as EpochTuple[];
  const epochs = new Map<string, EpochState>(
    touched.map((e, i) => [epochKey(e.stream, e.epochId), { root: states[i][0], open: states[i][4], spent: states[i][2] >= states[i][1] }]),
  );
  const live = liveLeaves(rows, epochs);
  if (live.length === 0) return [];

  const paid = (await client.multicall({
    allowFailure: false,
    contracts: live.map((c) => ({
      address: streamAddress(c.stream),
      abi: merkleEpochsAbi,
      functionName: "hasClaimed" as const,
      args: [BigInt(c.epochId), BigInt(c.tokenId)],
    })),
  })) as unknown as boolean[];
  return shareStatuses(live, paid, epochs);
}

/** How many recent UTC days to look back for the latest yield payout (a missed day or two). */
const LOOKBACK_DAYS = 4;

/**
 * The latest UTC day the chain opened a yield payout for, among the last few days, or null. Days
 * by CHAIN time, as the keeper numbers them (jobs.ts openStream), not this server's clock.
 */
export async function latestYieldDay(): Promise<number | null> {
  const today = Math.floor((await readChainTime()) / 86_400);
  const days = Array.from({ length: LOOKBACK_DAYS }, (_, i) => today - i);
  const states = (await getPublicClient().multicall({
    allowFailure: false,
    contracts: days.map((d) => ({
      address: streamAddress("yield"),
      abi: merkleEpochsAbi,
      functionName: "epochs" as const,
      args: [BigInt(d)],
    })),
  })) as unknown as EpochTuple[];
  return latestOpenDay(days, states.map((s) => s[4]));
}
