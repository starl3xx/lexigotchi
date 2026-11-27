/**
 * Derive the on-chain deploy config from the canonical economy, so the contracts can never drift
 * from the published Lexidex tables. Emits:
 *   - contracts/config/economy.json      — caps[26], weights[26], dictionaryRoot, headline totals
 *   - contracts/config/dictionary-tree.json — the OpenZeppelin StandardMerkleTree dump, from which
 *                                             the keeper/frontend generate per-word claim proofs
 *
 * The tree leaves are `[word, tier]` with types `['string', 'uint8']`, matching `Words.claim`'s
 * on-chain leaf `keccak256(bytes.concat(keccak256(abi.encode(word, tier))))` (decisions.md #60: the
 * claim fee by rarity). The tier is the word's DERIVED tier as a number (`TIER_INDEX`: 0 Common …
 * 4 Mythic): no collab set exists at deploy. The tree is built by the app's own module
 * (lib/onchain/dictionaryTree), so the deploy root and the proofs the game serves can't disagree.
 * The tier multipliers of the claim fee (`claimTierMultiplierBps`) are derived from the tiers'
 * earning weights (`CLAIM_MULTIPLE_BPS`). Run: `npm run derive:contracts`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { WORDS } from "../src/lib/dictionary";
import {
  ALPHABET,
  CLAIM_MULTIPLE_BPS,
  LETTER_SLOTS,
  LETTER_SUPPLY_CAP,
  TIER_INDEX,
  TIERS,
  TOTAL_SUPPLY_CAP,
  DEMAND_MULTIPLE,
  wordTier,
} from "../src/lib/economy";
import { LEAF_TYPES, treeWithout } from "../src/lib/onchain/dictionaryTree";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../contracts/config");
mkdirSync(outDir, { recursive: true });

// Per-letter caps + demand-mirrored weights, indexed A(0)..Z(25) to match the 1155 ids.
const caps = ALPHABET.map((L) => LETTER_SUPPLY_CAP[L]);
const weights = ALPHABET.map((L) => LETTER_SLOTS[L]);

// Canonical dictionary Merkle tree (OZ StandardMerkleTree → proofs verify against MerkleProof), by
// the game's own builder; the dump below is the same values and types, for anyone reading proofs.
const root = treeWithout([], { format: "tiered" }).root;
const tree = StandardMerkleTree.of(
  WORDS.map((w) => [w, TIER_INDEX[wordTier(w)]]),
  [...LEAF_TYPES.tiered],
);
if (tree.root !== root) throw new Error(`the dump's root ${tree.root} is not the game's ${root}`);

const economy = {
  generatedBy: "scripts/derive-contracts-config.ts",
  demandMultiple: DEMAND_MULTIPLE,
  wordCount: WORDS.length,
  totalSupplyCap: TOTAL_SUPPLY_CAP,
  dictionaryRoot: root,
  leafTypes: LEAF_TYPES.tiered,
  tiers: TIERS.map((t) => t.name),
  claimTierMultiplierBps: CLAIM_MULTIPLE_BPS,
  caps,
  weights,
};

writeFileSync(resolve(outDir, "economy.json"), JSON.stringify(economy, null, 2) + "\n");
writeFileSync(resolve(outDir, "dictionary-tree.json"), JSON.stringify(tree.dump()));

console.log(`✓ contracts/config/economy.json`);
console.log(`  words         ${economy.wordCount}`);
console.log(`  supply cap    ${economy.totalSupplyCap}`);
console.log(`  dictionaryRoot ${economy.dictionaryRoot}  (leaves: word, tier)`);
console.log(`  claim tiers   ${TIERS.map((t, i) => `${t.name} ${CLAIM_MULTIPLE_BPS[i] / 10_000}×`).join(" · ")}`);
console.log(`✓ contracts/config/dictionary-tree.json (${WORDS.length} leaves)`);
