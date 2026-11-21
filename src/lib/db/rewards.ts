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
 * Store an epoch's whole tree, BESIDE any earlier tree for the same epoch. Never replace one.
 *
 * A keeper run can send openEpoch and lose track of it (an RPC timeout). The next run sees the
 * epoch still closed, builds a NEW tree (the world moved), and stores it, while the first run's
 * transaction may still land. Deleting the first tree here would leave an open epoch with no proofs
 * anywhere: funded rewards nobody can claim. Keeping both costs some rows; the claim route serves
 * only the tree whose root the chain actually opened. Storing the same tree twice is a no-op.
 * One transaction, so a reader never sees half a tree.
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
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(rewardLeaves).values(rows.slice(i, i + INSERT_CHUNK)).onConflictDoNothing();
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
