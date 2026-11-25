/**
 * The keeper pays every player's shares out itself (decisions.md #16; starl3xx, 2026-11-25: earnings
 * are "Paid automatically"). MerkleEpochs.claim is permissionless and always pays the share's
 * baked-in account, so the keeper can send everyone's claims, batched through Multicall3, the
 * morning each epoch opens. Players never sign, pay gas, or watch a 90-day window run out.
 *
 * The plan is pure (tested in tests/payout.test.ts); the job that reads and sends is
 * `payOut` in jobs.ts.
 */
import { encodeFunctionData } from "viem";
import { merkleEpochsAbi } from "@/lib/onchain/abis";
import type { Claimable } from "./claimables";

/**
 * Claims per transaction. A claim costs about 100k gas with a real proof (90,366 measured with an
 * empty one, forge gas report, 2026-11-25), so 150 is about 15M gas: well inside a Base block, and
 * small enough that one bad batch costs little.
 */
export const PAYOUT_BATCH = 150;

/**
 * The payout job's share of the daily cron's 300 s (api/cron/keeper maxDuration): it starts no new
 * batch after this. What's left is paid on the next run; nothing is lost, only later.
 */
export const PAYOUT_BUDGET_MS = 90_000;

/** Multicall3, deployed at the same address on every chain we use (and in viem's chain objects). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const multicall3Abi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

/** Split the unpaid shares into batches, oldest epoch first (each batch one transaction). */
export function payoutBatches<T extends Pick<Claimable, "epochId" | "stream" | "tokenId">>(unpaid: readonly T[], size: number = PAYOUT_BATCH): T[][] {
  const sorted = [...unpaid].sort(
    (a, b) => Number(BigInt(a.epochId) - BigInt(b.epochId)) || a.stream.localeCompare(b.stream) || a.tokenId.localeCompare(b.tokenId),
  );
  const out: T[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

/**
 * One batch as Multicall3 calls. `allowFailure`: one share that can't be paid (someone collected
 * it a moment earlier) must not stop the rest of the batch.
 */
export function payoutCalls(batch: readonly Claimable[], streamAddress: (s: Claimable["stream"]) => `0x${string}`) {
  return batch.map((c) => ({
    target: streamAddress(c.stream),
    allowFailure: true,
    callData: encodeFunctionData({
      abi: merkleEpochsAbi,
      functionName: "claim",
      args: [BigInt(c.epochId), BigInt(c.tokenId), c.account, BigInt(c.amount), c.proof],
    }),
  }));
}
