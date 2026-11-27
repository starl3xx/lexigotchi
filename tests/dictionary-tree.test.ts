import { describe, it, expect } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { dictionaryRoot, proofFor, assertMatchesRoot, treeWithout } from "@/lib/onchain/dictionaryTree";
import { CLAIM_MULTIPLE_BPS, RANKED_WORDS, TIERS, wordTier } from "@/lib/economy";
import economy from "../contracts/config/economy.json";

/**
 * The word-only root (leaves of the word alone): what a Words from before the claim fee by rarity
 * verifies (decisions.md #60; Base Sepolia's until the held redeploy). Pinned, because the committed
 * config now holds the tiered root: this one must never move while that contract is live.
 */
const WORD_ONLY_ROOT = "0xdd0d993a450a363898fd08b9e590248c3a40d2bcf8b1c3743eb34f54973b862f";

/**
 * The tree is rebuilt in memory rather than read from contracts/config/dictionary-tree.json, because
 * that file is gitignored and would be absent from every deployment — a route depending on it works
 * in local testing and 404s in production. These tests pin the rebuild against the committed root,
 * which is the same root the deployed Words contract verifies proofs against.
 */
describe("rebuilt dictionary tree", () => {
  it("reproduces the committed dictionary root exactly (leaves of word and tier)", () => {
    expect(dictionaryRoot("tiered").toLowerCase()).toBe(economy.dictionaryRoot.toLowerCase());
    expect(economy.leafTypes).toEqual(["string", "uint8"]);
  });

  it("keeps the word-only root the older Words verifies, byte for byte", () => {
    expect(dictionaryRoot().toLowerCase()).toBe(WORD_ONLY_ROOT);
    expect(dictionaryRoot("word").toLowerCase()).toBe(WORD_ONLY_ROOT);
  });

  it("assertMatchesRoot passes for the real root and throws for a drifted one", () => {
    expect(() => assertMatchesRoot(economy.dictionaryRoot, "tiered")).not.toThrow();
    expect(() => assertMatchesRoot(WORD_ONLY_ROOT)).not.toThrow();
    expect(() => assertMatchesRoot(economy.dictionaryRoot)).toThrow(/drifted|mismatch/i); // the other format
    expect(() => assertMatchesRoot("0x" + "11".repeat(32))).toThrow(/drifted|mismatch/i);
  });

  it("is case-insensitive on input and always returns the UPPERCASE form", () => {
    // The contract requires 'A'..'Z' and tokenId is keccak256 of that same string.
    for (const input of ["crane", "CRANE", "Crane", " crane "]) {
      expect(proofFor(input)?.word).toBe("CRANE");
    }
  });

  it("returns a stable proof for a known word", () => {
    const p = proofFor("CRANE")!;
    expect(p.proof).toHaveLength(12);
    expect(p.proof[0]).toBe("0x42efaf16460bf30b8efb6d8146c64fe1d96cba7ba67a27dea0b300a6ca818114"); // 4,584-word tree
  });

  it("returns null for a non-dictionary word rather than an unverifiable proof", () => {
    expect(proofFor("zzzzz")).toBeNull();
    expect(proofFor("qqqqq")).toBeNull();
  });

  it("covers the full vendored dictionary", () => {
    // Spot-check across the alphabet rather than all 4,584 — the root assertion already covers
    // completeness, this catches an indexing bug that a single lookup would miss.
    for (const w of ["ABACK", "CRANE", "MOTOR", "SLATE", "ZONAL"]) {
      const p = proofFor(w);
      expect(p, `${w} should be in the dictionary`).not.toBeNull();
      expect(p!.proof.length).toBeGreaterThan(0);
    }
  });
});

describe("the tiered tree (decisions.md #60: leaf = word, tier)", () => {
  it("names each word's derived tier, and its proof verifies with the tier the contract takes", () => {
    const tree = treeWithout([], { format: "tiered" });
    const mythic = RANKED_WORDS[RANKED_WORDS.length - 1].word;
    for (const w of ["CRANE", mythic]) {
      const p = tree.proofFor(w)!;
      expect(p.tier).toBe(wordTier(w));
      expect(p.tierIndex).toBe(TIERS.findIndex((t) => t.name === wordTier(w)));
      expect(StandardMerkleTree.verify(tree.root, ["string", "uint8"], [w, p.tierIndex!], p.proof)).toBe(true);
      // The wrong tier fails the same proof: a claimer can't understate it.
      for (let t = 0; t < TIERS.length; t++) {
        if (t !== p.tierIndex) expect(StandardMerkleTree.verify(tree.root, ["string", "uint8"], [w, t], p.proof)).toBe(false);
      }
    }
  });

  it("the word-only tree carries no tier", () => {
    const p = proofFor("CRANE")!;
    expect(p.tier).toBeNull();
    expect(p.tierIndex).toBeNull();
  });

  it("a collab word in the tree is Legendary in its leaf, and only a word the tree holds moves the root", () => {
    const common = RANKED_WORDS.find((r) => r.tier === "Common")!.word;
    const plain = treeWithout([], { format: "tiered" });
    const raised = treeWithout([], { format: "tiered", collab: new Set([common]) });
    expect(raised.proofFor(common)!.tier).toBe("Legendary");
    expect(raised.root).not.toBe(plain.root);
    // Held back (a collab set before its release): the raise can't touch a leaf that isn't there.
    expect(treeWithout([common], { format: "tiered", collab: new Set([common]) }).root).toBe(treeWithout([common], { format: "tiered" }).root);
    // A word whose own tier is higher keeps it.
    const mythic = RANKED_WORDS[RANKED_WORDS.length - 1].word;
    expect(treeWithout([], { format: "tiered", collab: new Set([mythic]) }).proofFor(mythic)!.tier).toBe("Mythic");
    // The word-only format ignores the collab words.
    expect(treeWithout([], { format: "word", collab: new Set([common]) }).root).toBe(WORD_ONLY_ROOT);
  });

  it("the deploy config's multipliers are the tiers' earning weights over Common's", () => {
    expect(economy.claimTierMultiplierBps).toEqual([...CLAIM_MULTIPLE_BPS]);
    expect(economy.claimTierMultiplierBps).toEqual(TIERS.map((t) => (t.weight / TIERS[0].weight) * 10_000));
    expect(economy.tiers).toEqual(TIERS.map((t) => t.name));
  });
});

describe("tokenId derivation", () => {
  it("matches the on-chain keccak256(UPPERCASE word)", async () => {
    const { tokenIdHexOf, tokenIdOf } = await import("@/lib/onchain/tokenId");
    // Verified against `cast keccak "CRANE"` and the live Words NFT minted on Sepolia.
    expect(tokenIdHexOf("CRANE")).toBe("0x053a04303a8853e6e41c7292210e5152aa36137238899a88dd3b25f2f7eee6d9");
    expect(tokenIdOf("CRANE")).toBe(BigInt("0x053a04303a8853e6e41c7292210e5152aa36137238899a88dd3b25f2f7eee6d9"));
  });

  it("normalises case and whitespace — a lowercased word is a DIFFERENT token", async () => {
    const { tokenIdHexOf } = await import("@/lib/onchain/tokenId");
    const canonical = tokenIdHexOf("CRANE");
    for (const v of ["crane", "Crane", " crane "]) expect(tokenIdHexOf(v)).toBe(canonical);
    // The raw lowercase hash is genuinely different — this is why normalising matters.
    const { keccak256, toBytes } = await import("viem");
    expect(keccak256(toBytes("crane"))).not.toBe(canonical);
  });
});
