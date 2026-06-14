/**
 * Derive the on-chain deploy config from the canonical economy, so the contracts can never drift
 * from the published Lexidex tables. Emits:
 *   - contracts/config/economy.json      — caps[26], weights[26], dictionaryRoot, headline totals
 *   - contracts/config/dictionary-tree.json — the OpenZeppelin StandardMerkleTree dump, from which
 *                                             the keeper/frontend generate per-word claim proofs
 *
 * The tree leaves are `[word]` with type `['string']`, matching `Words.claim`'s on-chain leaf
 * `keccak256(bytes.concat(keccak256(abi.encode(word))))`. Run: `npm run derive:contracts`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { WORDS } from "../src/lib/dictionary";
import {
  ALPHABET,
  LETTER_SLOTS,
  LETTER_SUPPLY_CAP,
  TOTAL_SUPPLY_CAP,
  DEMAND_MULTIPLE,
} from "../src/lib/economy";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../contracts/config");
mkdirSync(outDir, { recursive: true });

// Per-letter caps + demand-mirrored weights, indexed A(0)..Z(25) to match the 1155 ids.
const caps = ALPHABET.map((L) => LETTER_SUPPLY_CAP[L]);
const weights = ALPHABET.map((L) => LETTER_SLOTS[L]);

// Canonical dictionary Merkle tree (OZ StandardMerkleTree → proofs verify against MerkleProof).
const tree = StandardMerkleTree.of(
  WORDS.map((w) => [w]),
  ["string"],
);

const economy = {
  generatedBy: "scripts/derive-contracts-config.ts",
  demandMultiple: DEMAND_MULTIPLE,
  wordCount: WORDS.length,
  totalSupplyCap: TOTAL_SUPPLY_CAP,
  dictionaryRoot: tree.root,
  caps,
  weights,
};

writeFileSync(resolve(outDir, "economy.json"), JSON.stringify(economy, null, 2) + "\n");
writeFileSync(resolve(outDir, "dictionary-tree.json"), JSON.stringify(tree.dump()));

console.log(`✓ contracts/config/economy.json`);
console.log(`  words         ${economy.wordCount}`);
console.log(`  supply cap    ${economy.totalSupplyCap}`);
console.log(`  dictionaryRoot ${economy.dictionaryRoot}`);
console.log(`✓ contracts/config/dictionary-tree.json (${WORDS.length} leaves)`);
