import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { RewardLeaf } from "./shares";

/**
 * The Merkle side of an epoch. MerkleEpochs.claim verifies
 * `keccak256(bytes.concat(keccak256(abi.encode(tokenId, account, amount))))` — which is exactly
 * OZ StandardMerkleTree's leaf encoding for ['uint256','address','uint256'], the same library the
 * dictionary proofs already use. The published file carries every entry WITH its proof, so the
 * proof API can serve claims without re-deriving anything.
 */

const LEAF_TYPES = ["uint256", "address", "uint256"];

export interface EpochFile {
  root: `0x${string}`;
  /** Sum of all amounts — what openEpoch must be funded with (its `amount` arg). */
  total: string;
  entries: { tokenId: string; account: `0x${string}`; amount: string; proof: `0x${string}`[] }[];
}

export function buildEpochFile(leaves: readonly RewardLeaf[]): EpochFile {
  const values = leaves.map((l) => [l.tokenId.toString(), l.account, l.amount.toString()]);
  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  return {
    root: tree.root as `0x${string}`,
    total: leaves.reduce((a, l) => a + l.amount, 0n).toString(),
    entries: values.map((v, i) => ({
      tokenId: v[0],
      account: v[1] as `0x${string}`,
      amount: v[2],
      proof: tree.getProof(i) as `0x${string}`[],
    })),
  };
}

/** Round-trip check used by tests and the keeper's --dry mode. */
export function verifyEntry(root: string, e: EpochFile["entries"][number]): boolean {
  return StandardMerkleTree.verify(root, LEAF_TYPES, [e.tokenId, e.account, e.amount], e.proof);
}
