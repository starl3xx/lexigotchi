/**
 * The dictionary Merkle tree, rebuilt in memory.
 *
 * `Words.claim` verifies a proof against the on-chain `dictionaryRoot`, so the app has to produce
 * proofs. The obvious source is `contracts/config/dictionary-tree.json` — but that file is
 * GITIGNORED (.gitignore:49), so it exists on a dev machine and is absent from every deployment.
 * A route reading it would work perfectly in local testing and 404 in production.
 *
 * The tree is a pure function of the vendored dictionary, so we rebuild it from `WORDS` exactly as
 * scripts/derive-contracts-config.ts does (that script calls this module). Same input, same
 * construction, same root — and `assertMatchesRoot` lets a caller prove that against the chain
 * rather than assume it.
 *
 * TWO LEAF FORMATS (decisions.md #60, the claim fee by rarity). A Words deployed with the tiered
 * fee verifies leaves of (word, tier), leaf types ["string", "uint8"], the tier being the word's
 * place in TIERS (`TIER_INDEX`): the claim names its tier and the proof checks it. An older Words
 * (Base Sepolia's until the held redeploy) verifies leaves of the word alone, ["string"]. Which one a
 * network has is the registry's answer (`wordsHaveClaimTiers` in addresses.ts), passed in here as
 * `format`; this module never guesses it.
 *
 * In the tiered format a leaf's tier is the tier the GAME treats the word as (lib/rarity.ts
 * `tierWith`): the derived tier, except that a word of a revealed collab set is Legendary unless its
 * own tier is higher. So the tier a claim pays for is the tier every screen shows. The collab words
 * are passed in (this module reads no set); with none, the tree is the derived dictionary's, which
 * is what `npm run derive:contracts` commits as the deploy root.
 *
 * Build cost is a few milliseconds for 4,584 leaves, paid once per tree per server start.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { WORDS } from "@/lib/dictionary";
import { TIER_INDEX, type Tier } from "@/lib/economy";
import { NO_COLLAB, raisedByCollab, tierWith, type CollabWords } from "@/lib/rarity";

/** How a network's Words hashes a dictionary leaf: the word alone, or (word, tier). */
export type LeafFormat = "word" | "tiered";

/** The OpenZeppelin leaf types of each format: what `Words._checkClaim` encodes. */
export const LEAF_TYPES: Readonly<Record<LeafFormat, readonly string[]>> = Object.freeze({
  word: ["string"],
  tiered: ["string", "uint8"],
});

/** A proof, and (in the tiered format) the tier the claim must name. */
export interface DictionaryProof {
  word: string;
  proof: `0x${string}`[];
  /** The leaf's tier (tiered format only; null in the word-only format, whose claim names none). */
  tier: Tier | null;
  /** The same as the number the contract takes (TIER_INDEX), or null. */
  tierIndex: number | null;
}

/** A dictionary tree: the full one, or one that leaves some words out (reserved sets). */
export interface DictionaryTree {
  /** Should equal Words.dictionaryRoot() while the chain holds this tree. */
  root: `0x${string}`;
  /** How many words it holds. */
  size: number;
  format: LeafFormat;
  has(word: string): boolean;
  /** The Merkle proof for a word (UPPERCASE in the answer), or null when the tree doesn't hold it. */
  proofFor(word: string): DictionaryProof | null;
}

/** What a tree is built from, besides the words it leaves out. */
export interface TreeOptions {
  /** The network's leaf format. Default "word", the older contract's. */
  format?: LeafFormat;
  /** The words of every revealed collab set (tiered format only: they raise a leaf's tier). */
  collab?: CollabWords;
}

function buildTree(words: readonly string[], format: LeafFormat, collab: CollabWords): DictionaryTree {
  const tierOf = (w: string): Tier | null => (format === "tiered" ? tierWith(w, collab) : null);
  const values = words.map((w) => (format === "tiered" ? [w, TIER_INDEX[tierOf(w)!]] : [w]));
  const tree = StandardMerkleTree.of(values, [...LEAF_TYPES[format]]);
  const index = new Map<string, number>();
  for (const [i, v] of tree.entries()) {
    const key = String(v[0]).toUpperCase();
    // One leaf a word, always. Words.sol can't check it: a root that held a word under two tiers
    // would let a claimer pick the cheaper leaf (the audit's note on decisions.md #60).
    if (index.has(key)) throw new Error(`the dictionary tree would hold ${key} twice`);
    index.set(key, i);
  }
  return {
    root: tree.root as `0x${string}`,
    size: words.length,
    format,
    has: (word) => index.has(word.trim().toUpperCase()),
    proofFor(word) {
      const key = word.trim().toUpperCase();
      const i = index.get(key);
      if (i === undefined) return null;
      const tier = tierOf(key);
      return { word: key, proof: tree.getProof(i) as `0x${string}`[], tier, tierIndex: tier === null ? null : TIER_INDEX[tier] };
    },
  };
}

/**
 * Trees kept by what built them. A reserved-sets deployment serves one tree at a time (the one the
 * chain holds) and builds another only when the operator plans a root change, so a handful is
 * plenty; the oldest is dropped past that.
 */
const KEEP = 6;
const trees = new Map<string, DictionaryTree>();

/**
 * The tree of the dictionary WITHOUT `held` (reserved word sets: a held-back word is one the root
 * leaves out). Words that aren't in the dictionary are ignored. `treeWithout([])` is the full tree.
 * In the tiered format, `collab` raises its words' leaves to Legendary (see the file's header).
 */
export function treeWithout(held: Iterable<string>, opts: TreeOptions = {}): DictionaryTree {
  const format = opts.format ?? "word";
  const collab = format === "tiered" ? (opts.collab ?? NO_COLLAB) : NO_COLLAB;
  const out = new Set<string>();
  for (const w of held) out.add(w.trim().toUpperCase());
  const left = out.size ? WORDS.filter((w) => !out.has(w)) : WORDS;
  // Keyed by what actually shapes the tree: the format, what is left out (so the same list in
  // another order is the same tree), and which of the words it holds a collab set raises.
  const raised = collab.size ? left.filter((w) => raisedByCollab(w, collab)) : [];
  const key = `${format}|${out.size ? WORDS.filter((w) => out.has(w)).join(",") : ""}|${raised.join(",")}`;
  const kept = trees.get(key);
  if (kept) return kept;
  const tree = buildTree(left, format, collab);
  trees.set(key, tree);
  if (trees.size > KEEP) {
    // Never drop a full tree: every deployment without sets serves one on every claim.
    for (const k of trees.keys()) {
      if (!/^\w+\|\|$/.test(k)) {
        trees.delete(k);
        break;
      }
    }
  }
  return tree;
}

/** The FULL dictionary's root, by the derived tiers: what Words.dictionaryRoot() holds at deploy. */
export function dictionaryRoot(format: LeafFormat = "word"): `0x${string}` {
  return treeWithout([], { format }).root;
}

/**
 * Merkle proof for a word in the FULL tree, or null when it isn't in the dictionary.
 * Case-insensitive on input; the contract requires the UPPERCASE form, which is what's returned.
 * The proof route serves from the tree the chain holds (lib/sets/server.ts), which is this one only
 * while no word is held back and no collab set raises one.
 */
export function proofFor(word: string, format: LeafFormat = "word"): DictionaryProof | null {
  return treeWithout([], { format }).proofFor(word);
}

/** Throw unless the rebuilt tree matches the root the contract will verify against. */
export function assertMatchesRoot(onChainRoot: string, format: LeafFormat = "word"): void {
  const local = dictionaryRoot(format).toLowerCase();
  if (local !== onChainRoot.toLowerCase()) {
    throw new Error(
      `Dictionary root mismatch: rebuilt ${local} but the contract expects ${onChainRoot}. ` +
        `The vendored dictionary has drifted from the deployed root — re-run npm run derive:contracts.`,
    );
  }
}
