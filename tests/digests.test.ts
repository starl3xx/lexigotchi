import { describe, it, expect } from "vitest";
import {
  paidDailyDigest,
  freeDailyDigest,
  freePackDigest,
  lettersRevealDigest,
  rollsRevealDigest,
  prestigeRevealDigest,
  ethSignedMessageHash,
  chainDay,
  KIND_FREE_DAILY,
  KIND_FREE_PACK,
} from "@/lib/onchain/digests";

/**
 * These vectors were produced by FOUNDRY, not by this code:
 *   cast keccak "$(cast abi-encode 'f(address,uint256,...)' ...)"
 * so the assertions are viem's encoder agreeing with Solidity's, independently. A digest that
 * disagrees by one field yields BadSignature() on-chain 100% of the time with no other symptom,
 * which is exactly the failure a self-consistent test would miss.
 *
 * Chain id is NETWORK.id, which is 8453 under test (NEXT_PUBLIC_CHAIN_ID unset), and the vectors
 * were generated with 8453 to match.
 */
const L = "0xdf7bB55D701d16d772Fad43f53eE4560De2De263" as const;
const B = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3" as const;
const RO = "0x87C79617FE94717706cC983cAF22052990393Cb0" as const;
const PR = "0xf01733cf1Ba945AFB766404871dd0F64493312d8" as const;
const TID = 0x053a04303a8853e6e41c7292210e5152aa36137238899a88dd3b25f2f7eee6d9n; // keccak256("CRANE")
const FID = 12345n;
const TODAY = 20315;
const DL = 1786000000n;

describe("signer digests match Foundry's abi.encode byte-for-byte", () => {
  it("paid daily (no kind byte)", () => {
    expect(paidDailyDigest({ letters: L, buyer: B, fid: FID, today: TODAY, deadline: DL })).toBe(
      "0x9d55af38f34d42d57d6c3af80da37a3d00a86a752683407068a064a0d4fe7a0f",
    );
  });

  it("free daily (KIND_FREE_DAILY = 0)", () => {
    expect(freeDailyDigest({ letters: L, buyer: B, fid: FID, today: TODAY, deadline: DL })).toBe(
      "0xeb35ef72ce2beec8ff0b403e5a6f27c3ad70c4a8fc83e47b4f92a50120616e68",
    );
  });

  it("free pack (KIND_FREE_PACK = 1, nonce-scoped)", () => {
    expect(freePackDigest({ letters: L, buyer: B, fid: FID, nonce: 7n, deadline: DL })).toBe(
      "0xdc26a10f301c2c11d14151a8921d977156252426b29a8dfb84eac56fb2c917e2",
    );
  });

  it("letters reveal (dynamic uint8[] encoding)", () => {
    expect(lettersRevealDigest({ letters: L, commitId: 3n, buyer: B, letterIndexes: [2, 17, 0, 13, 4] })).toBe(
      "0x9f04b2a77cdc0df960184bf42cf6fe843fb5530f1f7f3ef95801a4bea3fd0fdf",
    );
  });

  it("rolls reveal (letterIndex, no tokenId)", () => {
    expect(rollsRevealDigest({ rolls: RO, commitId: 3n, owner: B, letterIndex: 2, success: true })).toBe(
      "0x9220f2b7d8f4a6025b61a2f0cffc75a2a1ccaa254b7642b24ac08ed6a8f68756",
    );
  });

  it("prestige reveal (tokenId BEFORE owner)", () => {
    expect(prestigeRevealDigest({ prestige: PR, commitId: 3n, tokenId: TID, owner: B, success: true })).toBe(
      "0x674af556e9ecf53df8515f0cbe0617639f98e6ad39acf5d24da185cf47dbde74",
    );
  });

  it("wraps with the EIP-191 prefix exactly as MessageHashUtils does", () => {
    const inner = lettersRevealDigest({ letters: L, commitId: 3n, buyer: B, letterIndexes: [2, 17, 0, 13, 4] });
    expect(ethSignedMessageHash(inner)).toBe(
      "0x52867fb0935b0e1c1e437b6c858919e92e0021440caa224cb7024c1c6e3c6208",
    );
  });
});

describe("digests are actually distinct where it matters", () => {
  // The kind byte is what stops a free-daily voucher being replayed against the paid path.
  it("free and paid daily differ for identical inputs", () => {
    const args = { letters: L, buyer: B, fid: FID, today: TODAY, deadline: DL };
    expect(freeDailyDigest(args)).not.toBe(paidDailyDigest(args));
  });

  it("KIND constants match the contract", () => {
    expect(KIND_FREE_DAILY).toBe(0);
    expect(KIND_FREE_PACK).toBe(1);
  });

  it("every field is load-bearing — changing any one changes the digest", () => {
    const base = { rolls: RO, commitId: 3n, owner: B, letterIndex: 2, success: true };
    const d = rollsRevealDigest(base);
    expect(rollsRevealDigest({ ...base, commitId: 4n })).not.toBe(d);
    expect(rollsRevealDigest({ ...base, letterIndex: 3 })).not.toBe(d);
    expect(rollsRevealDigest({ ...base, success: false })).not.toBe(d);
    expect(rollsRevealDigest({ ...base, owner: L })).not.toBe(d);
  });

  it("letter ORDER is load-bearing (a reordered draw is a different digest)", () => {
    const a = lettersRevealDigest({ letters: L, commitId: 3n, buyer: B, letterIndexes: [2, 17, 0, 13, 4] });
    const b = lettersRevealDigest({ letters: L, commitId: 3n, buyer: B, letterIndexes: [17, 2, 0, 13, 4] });
    expect(a).not.toBe(b);
  });
});

describe("chainDay", () => {
  it("is UTC days since epoch, matching uint32(block.timestamp / 1 days)", () => {
    expect(chainDay(0)).toBe(0);
    expect(chainDay(86_399)).toBe(0);
    expect(chainDay(86_400)).toBe(1);
    expect(chainDay(1_786_000_000)).toBe(Math.floor(1_786_000_000 / 86_400));
  });

  it("rolls at UTC midnight, not local midnight", () => {
    // 2026-08-12T23:59:59Z and 2026-08-13T00:00:00Z are different chain days.
    expect(chainDay(Date.UTC(2026, 7, 12, 23, 59, 59) / 1000)).toBe(
      chainDay(Date.UTC(2026, 7, 12, 0, 0, 0) / 1000),
    );
    expect(chainDay(Date.UTC(2026, 7, 13, 0, 0, 0) / 1000)).toBe(
      chainDay(Date.UTC(2026, 7, 12, 0, 0, 0) / 1000) + 1,
    );
  });
});
