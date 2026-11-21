/**
 * Queries for the reward claim data (schema.ts → rewardLeaves): the keeper writes an epoch's tree,
 * the claim route reads a player's leaves. See the table's comment for the open-epoch rule.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { rewardLeaves, type RewardLeafRow } from "./schema";
import type { EpochFile } from "@/lib/keeper/tree";

export type RewardStream = "yield" | "bounty";

/** postgres-js caps a statement at 65,535 parameters; a leaf row binds 8, so stay well under. */
const INSERT_CHUNK = 1_000;

/**
 * Store an epoch's whole tree, replacing any earlier tree for the same epoch.
 *
 * Replace, not merge: a keeper run that built a tree but failed to open the epoch leaves rows
 * behind, and the next run builds a NEW tree (the world moved). Mixing proofs from two trees would
 * serve proofs that verify against neither root. One transaction, so a reader never sees half.
 */
export async function storeEpochLeaves(
  chainId: number,
  stream: RewardStream,
  epochId: bigint,
  epoch: EpochFile,
): Promise<void> {
  const id = epochId.toString();
  const rows = epoch.entries.map((e) => ({
    chainId,
    stream,
    epochId: id,
    root: epoch.root.toLowerCase(),
    tokenId: e.tokenId,
    account: e.account.toLowerCase(),
    amount: e.amount,
    proof: e.proof,
  }));
  await getDb().transaction(async (tx) => {
    await tx
      .delete(rewardLeaves)
      .where(and(eq(rewardLeaves.chainId, chainId), eq(rewardLeaves.stream, stream), eq(rewardLeaves.epochId, id)));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(rewardLeaves).values(rows.slice(i, i + INSERT_CHUNK));
    }
  });
}

/** Every stored leaf paying one of these wallets on this chain. Callers still check the chain. */
export async function rewardLeavesFor(chainId: number, accounts: readonly string[]): Promise<RewardLeafRow[]> {
  if (accounts.length === 0) return [];
  return getDb()
    .select()
    .from(rewardLeaves)
    .where(and(eq(rewardLeaves.chainId, chainId), inArray(rewardLeaves.account, accounts.map((a) => a.toLowerCase()))));
}
