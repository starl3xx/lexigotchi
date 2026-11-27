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
 * Build cost is a few milliseconds for 4,584 leaves, paid once per server cold start.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { WORDS } from "@/lib/dictionary";

type Tree = StandardMerkleTree<[string]>;

/** A dictionary tree: the full one, or one that leaves some words out (reserved sets). */
export interface DictionaryTree {
  /** Should equal Words.dictionaryRoot() while the chain holds this tree. */
  root: `0x${string}`;
  /** How many words it holds. */
  size: number;
  has(word: string): boolean;
  /** The Merkle proof for a word (UPPERCASE in the answer), or null when the tree doesn't hold it. */
  proofFor(word: string): { word: string; proof: `0x${string}`[] } | null;
}

function buildTree(words: readonly string[]): DictionaryTree {
  // Identical construction to the derive script — leafEncoding ["string"], one word per leaf.
  const tree: Tree = StandardMerkleTree.of(
    words.map((w) => [w] as [string]),
    ["string"],
  );
  const index = new Map<string, number>();
  for (const [i, v] of tree.entries()) index.set(String(v[0]).toUpperCase(), i);
  return {
    root: tree.root as `0x${string}`,
    size: words.length,
    has: (word) => index.has(word.trim().toUpperCase()),
    proofFor(word) {
      const key = word.trim().toUpperCase();
      const i = index.get(key);
      if (i === undefined) return null;
      return { word: key, proof: tree.getProof(i) as `0x${string}`[] };
    },
  };
}

/**
 * Trees kept by the words they leave out. A reserved-sets deployment serves one tree at a time (the
 * one the chain holds) and builds another only when the operator plans a root change, so a handful
 * is plenty; the oldest is dropped past that.
 */
const KEEP = 6;
const trees = new Map<string, DictionaryTree>();

/**
 * The tree of the dictionary WITHOUT `held` (reserved word sets: a held-back word is one the root
 * leaves out). Words that aren't in the dictionary are ignored. `treeWithout([])` is the full tree.
 */
export function treeWithout(held: Iterable<string>): DictionaryTree {
  const out = new Set<string>();
  for (const w of held) out.add(w.trim().toUpperCase());
  const left = out.size ? WORDS.filter((w) => !out.has(w)) : WORDS;
  // Keyed by what is actually left out, so the same list in another order is the same tree.
  const key = out.size ? WORDS.filter((w) => out.has(w)).join(",") : "";
  const kept = trees.get(key);
  if (kept) return kept;
  const tree = buildTree(left);
  trees.set(key, tree);
  if (trees.size > KEEP) {
    // Never drop the full tree: every deployment without sets serves it on every claim.
    for (const k of trees.keys()) {
      if (k !== "") {
        trees.delete(k);
        break;
      }
    }
  }
  return tree;
}

/** The FULL dictionary's root: what Words.dictionaryRoot() holds while no word is held back. */
export function dictionaryRoot(): `0x${string}` {
  return treeWithout([]).root;
}

/**
 * Merkle proof for a word in the FULL tree, or null when it isn't in the dictionary.
 * Case-insensitive on input; the contract requires the UPPERCASE form, which is what's returned.
 * The proof route serves from the tree the chain holds (lib/sets/server.ts), which is this one only
 * while no word is held back.
 */
export function proofFor(word: string): { word: string; proof: `0x${string}`[] } | null {
  return treeWithout([]).proofFor(word);
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
