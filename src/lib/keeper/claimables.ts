/**
 * Which stored reward leaves a player may claim right now. Pure, so the open-epoch rule is tested
 * without a database or a chain (tests/rewards-claimable.test.ts).
 */
import type { RewardLeafRow } from "@/lib/db/schema";

export interface Claimable {
  stream: "yield" | "bounty";
  epochId: string;
  tokenId: string;
  account: `0x${string}`;
  amount: string;
  proof: `0x${string}`[];
}

/** What `epochs(epochId)` says on chain, reduced to the two fields that decide servability. */
export interface EpochState {
  open: boolean;
  root: string;
}

export const epochKey = (stream: string, epochId: string) => `${stream}:${epochId}`;

/** The distinct epochs a set of rows touches, so the caller reads each one from the chain once. */
export function epochsOf(rows: readonly Pick<RewardLeafRow, "stream" | "epochId">[]): { stream: "yield" | "bounty"; epochId: string }[] {
  const seen = new Map<string, { stream: "yield" | "bounty"; epochId: string }>();
  for (const r of rows) seen.set(epochKey(r.stream, r.epochId), { stream: r.stream as "yield" | "bounty", epochId: r.epochId });
  return [...seen.values()];
}

/**
 * Keep a leaf only while its epoch is OPEN on chain with the SAME root the leaf was built for.
 *
 * The keeper stores a tree before it opens the epoch. If the open failed, the rows exist but the
 * epoch doesn't; if a later run rebuilt the tree, old proofs would fail against the new root. In
 * both cases a served leaf would become a claim() that reverts, so it is never served.
 */
export function liveLeaves(rows: readonly RewardLeafRow[], epochs: ReadonlyMap<string, EpochState>): Claimable[] {
  const out: Claimable[] = [];
  for (const r of rows) {
    const e = epochs.get(epochKey(r.stream, r.epochId));
    if (!e?.open || e.root.toLowerCase() !== r.root.toLowerCase()) continue;
    out.push({
      stream: r.stream as Claimable["stream"],
      epochId: r.epochId,
      tokenId: r.tokenId,
      account: r.account as `0x${string}`,
      amount: r.amount,
      proof: r.proof,
    });
  }
  return out;
}
