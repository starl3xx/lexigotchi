import { describe, it, expect } from "vitest";
import {
  verifiedDailyKey,
  attestationProves,
  VERIFIED_KEY_FLOOR,
  VERIFIED_ACCOUNT_SCHEMA,
  COINBASE_ATTESTER,
  type AttestationLike,
} from "@/lib/onchain/verifications";

const WALLET = "0x1B48CB57bC44E1B1a4F58e2669E5c391e0691Cc7";

/**
 * The namespace is the whole safety argument: `dailyUsed` and `freePackClaimed` are ONE shared
 * uint256 keyspace on-chain, so a synthetic key that ever came out small would silently spend a
 * real FID's slot. These tests pin the floor rather than trusting the construction.
 */
describe("verifiedDailyKey — the synthetic namespace", () => {
  it("never emits a key below 2^160, even for the zero-adjacent address", () => {
    // The hazard case from the audit: a low-value address like 0x...01234 would numerically equal
    // a real FID if the offset were ever dropped.
    const low = verifiedDailyKey("0x0000000000000000000000000000000000001234");
    expect(low >= VERIFIED_KEY_FLOOR).toBe(true);
    expect(low).toBe(VERIFIED_KEY_FLOOR + 0x1234n);
  });

  it("stays below 2^161 even for the max address (no bleed into a third namespace)", () => {
    const max = verifiedDailyKey("0xffffffffffffffffffffffffffffffffffffffff");
    expect(max < 1n << 161n).toBe(true);
  });

  it("is disjoint from every representable FID", () => {
    // FIDs are small sequential ints; even a pathological 2^53-scale one can't reach the floor.
    expect(VERIFIED_KEY_FLOOR > 2n ** 53n).toBe(true);
  });

  it("is case-insensitive: checksummed and lowercased addresses share a key", () => {
    expect(verifiedDailyKey(WALLET)).toBe(verifiedDailyKey(WALLET.toLowerCase()));
  });

  it("distinct addresses get distinct keys", () => {
    expect(verifiedDailyKey(WALLET)).not.toBe(
      verifiedDailyKey("0x1B48CB57bC44E1B1a4F58e2669E5c391e0691Cc8"),
    );
  });

  it("survives the JSON round-trip exactly (String → BigInt)", () => {
    // The voucher carries the key as a string because JSON numbers stop being exact at 2^53.
    const key = verifiedDailyKey(WALLET);
    expect(BigInt(String(key))).toBe(key);
    // And the trap the route must never reintroduce: through a JS number it does NOT survive.
    expect(BigInt(Number(key))).not.toBe(key);
  });

  it("rejects non-addresses instead of hashing garbage into the shared keyspace", () => {
    expect(() => verifiedDailyKey("42")).toThrow();
    expect(() => verifiedDailyKey("0x1234")).toThrow();
  });
});

describe("attestationProves — the pure validator", () => {
  const NOW = 1_755_000_000;
  const valid: AttestationLike = {
    schema: VERIFIED_ACCOUNT_SCHEMA,
    recipient: WALLET,
    attester: COINBASE_ATTESTER,
    revocationTime: 0n,
    expirationTime: 0n,
  };

  it("accepts a live Coinbase attestation", () => {
    expect(attestationProves(valid, WALLET, NOW)).toBe(true);
  });

  it("accepts regardless of address casing on either side", () => {
    expect(
      attestationProves({ ...valid, recipient: WALLET.toUpperCase().replace("0X", "0x") }, WALLET.toLowerCase(), NOW),
    ).toBe(true);
  });

  it("rejects a revoked attestation — Coinbase pulled it", () => {
    expect(attestationProves({ ...valid, revocationTime: 1n }, WALLET, NOW)).toBe(false);
  });

  it("rejects the wrong schema (a Verified Country attestation is not a Verified Account)", () => {
    expect(
      attestationProves(
        { ...valid, schema: "0x1801901fabd0e6189356b4fb52bb0ab855276d84f7ec140839fbd1f6801ca065" },
        WALLET,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects any attester but Coinbase — anyone can attest any schema on EAS", () => {
    expect(
      attestationProves({ ...valid, attester: "0x1B48CB57bC44E1B1a4F58e2669E5c391e0691Cc7" }, WALLET, NOW),
    ).toBe(false);
  });

  it("rejects an attestation for a different wallet — the indexer could return a stale uid", () => {
    expect(
      attestationProves({ ...valid, recipient: "0x1B48CB57bC44E1B1a4F58e2669E5c391e0691Cc8" }, WALLET, NOW),
    ).toBe(false);
  });

  it("treats expirationTime 0 as no expiry, and a past expiry as dead", () => {
    expect(attestationProves({ ...valid, expirationTime: BigInt(NOW + 60) }, WALLET, NOW)).toBe(true);
    expect(attestationProves({ ...valid, expirationTime: BigInt(NOW - 60) }, WALLET, NOW)).toBe(false);
    expect(attestationProves({ ...valid, expirationTime: BigInt(NOW) }, WALLET, NOW)).toBe(false);
  });
});
