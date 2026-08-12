import { describe, it, expect } from "vitest";
import { dictionaryRoot, proofFor, assertMatchesRoot } from "@/lib/onchain/dictionaryTree";
import economy from "../contracts/config/economy.json";

/**
 * The tree is rebuilt in memory rather than read from contracts/config/dictionary-tree.json, because
 * that file is gitignored and would be absent from every deployment — a route depending on it works
 * in local testing and 404s in production. These tests pin the rebuild against the committed root,
 * which is the same root the deployed Words contract verifies proofs against.
 */
describe("rebuilt dictionary tree", () => {
  it("reproduces the committed dictionary root exactly", () => {
    expect(dictionaryRoot().toLowerCase()).toBe(economy.dictionaryRoot.toLowerCase());
  });

  it("assertMatchesRoot passes for the real root and throws for a drifted one", () => {
    expect(() => assertMatchesRoot(economy.dictionaryRoot)).not.toThrow();
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
    expect(p.proof[0]).toBe("0x42d44c493d4fd7d63fddcc7a777379f861156a1271a30341a31b628cd8bb692f");
  });

  it("returns null for a non-dictionary word rather than an unverifiable proof", () => {
    expect(proofFor("zzzzz")).toBeNull();
    expect(proofFor("qqqqq")).toBeNull();
  });

  it("covers the full vendored dictionary", () => {
    // Spot-check across the alphabet rather than all 4,438 — the root assertion already covers
    // completeness, this catches an indexing bug that a single lookup would miss.
    for (const w of ["ABACK", "CRANE", "MOTOR", "SLATE", "ZONAL"]) {
      const p = proofFor(w);
      expect(p, `${w} should be in the dictionary`).not.toBeNull();
      expect(p!.proof.length).toBeGreaterThan(0);
    }
  });
});
