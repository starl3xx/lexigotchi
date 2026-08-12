/**
 * The dictionary Merkle tree, rebuilt in memory.
 *
 * `Words.claim` verifies a proof against the on-chain `dictionaryRoot`, so the app has to produce
 * proofs. The obvious source is `contracts/config/dictionary-tree.json` — but that file is
 * GITIGNORED (.gitignore:49), so it exists on a dev machine and is absent from every deployment.
 * A route reading it would work perfectly in local testing and 404 in production.
 *
 * The tree is a pure function of the vendored dictionary, so we rebuild it from `WORDS` exactly as
 * scripts/derive-contracts-config.ts does. Same input, same construction, same root — and
 * `assertMatchesRoot` lets a caller prove that against the chain rather than assume it.
 *
 * Build cost is a few milliseconds for 4,438 leaves, paid once per server cold start.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { WORDS } from "@/lib/dictionary";

type Tree = StandardMerkleTree<[string]>;

let tree: Tree | undefined;
let indexByWord: Map<string, number> | undefined;

function build(): { tree: Tree; index: Map<string, number> } {
  if (!tree || !indexByWord) {
    // Identical construction to the derive script — leafEncoding ["string"], one word per leaf.
    tree = StandardMerkleTree.of(
      WORDS.map((w) => [w] as [string]),
      ["string"],
    );
    indexByWord = new Map();
    for (const [i, v] of tree.entries()) indexByWord.set(String(v[0]).toUpperCase(), i);
  }
  return { tree, index: indexByWord };
}

/** The computed root. Should equal Words.dictionaryRoot() on the target network. */
export function dictionaryRoot(): `0x${string}` {
  return build().tree.root as `0x${string}`;
}

/**
 * Merkle proof for a word, or null when it isn't in the dictionary.
 * Case-insensitive on input; the contract requires the UPPERCASE form, which is what's returned.
 */
export function proofFor(word: string): { word: string; proof: `0x${string}`[] } | null {
  const { tree, index } = build();
  const key = word.trim().toUpperCase();
  const i = index.get(key);
  if (i === undefined) return null;
  return { word: key, proof: tree.getProof(i) as `0x${string}`[] };
}

/** Throw unless the rebuilt tree matches the root the contract will verify against. */
export function assertMatchesRoot(onChainRoot: string): void {
  const local = dictionaryRoot().toLowerCase();
  if (local !== onChainRoot.toLowerCase()) {
    throw new Error(
      `Dictionary root mismatch: rebuilt ${local} but the contract expects ${onChainRoot}. ` +
        `The vendored dictionary has drifted from the deployed root — re-run npm run derive:contracts.`,
    );
  }
}
