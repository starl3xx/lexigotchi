/**
 * The claim fee by rarity (decisions.md #60, the "gentle ladder"): the base claim fee (a Common
 * word's) times the tier's earning weight over Common's. Every number here is derived from TIERS
 * and params, never typed, except the targets the owner named, which the derivation must hit.
 */
import { describe, it, expect, vi } from "vitest";
import { CLAIM_MULTIPLE, CLAIM_MULTIPLE_BPS, TIERS, TIER_COUNTS, TIER_INDEX, TIER_WEIGHT } from "@/lib/economy";
import { DEFAULT_PARAMS, FLAT_CLAIM_MULTIPLE, claimFeeUsd } from "@/lib/params";
import { PRACTICE_TIER_BPS, claimFeeWei, claimFeeWord, claimLadderUsd, isTier, ladderDollars } from "@/lib/claimFee";
import { sumClaimRevenue } from "@/lib/onchain/claimRevenue";

describe("the ladder", () => {
  it("is the base times each tier's earning weight: the owner's targets", () => {
    // starl3xx, 2026-11-27: Common $0.50 · Uncommon $1.00 · Rare $1.50 · Legendary $2.50 · Mythic $4.00.
    expect(claimLadderUsd().map((r) => [r.tier, r.usd])).toEqual([
      ["Common", 0.5],
      ["Uncommon", 1],
      ["Rare", 1.5],
      ["Legendary", 2.5],
      ["Mythic", 4],
    ]);
    for (const t of TIERS) expect(CLAIM_MULTIPLE[t.name]).toBe(TIER_WEIGHT[t.name] / TIER_WEIGHT.Common);
    expect(DEFAULT_PARAMS.claimMultiple).toEqual(CLAIM_MULTIPLE);
    expect(CLAIM_MULTIPLE_BPS).toEqual([10_000, 20_000, 30_000, 50_000, 80_000]);
    expect(PRACTICE_TIER_BPS).toEqual(CLAIM_MULTIPLE_BPS);
  });

  it("a first word, a Common one, still costs the base", () => {
    expect(claimFeeUsd("Common")).toBe(DEFAULT_PARAMS.prices.claim);
    expect(DEFAULT_PARAMS.prices.claim).toBe(0.5);
  });

  it("roughly doubles what the whole dictionary pays to claim (about $2,300 flat, about $4,200 on the ladder)", () => {
    const flat = { ...DEFAULT_PARAMS, claimMultiple: { ...FLAT_CLAIM_MULTIPLE } };
    const total = (p: typeof DEFAULT_PARAMS) => TIERS.reduce((a, t) => a + TIER_COUNTS[t.name] * claimFeeUsd(t.name, p), 0);
    expect(total(flat)).toBeCloseTo(2292, 6);
    expect(total(DEFAULT_PARAMS)).toBeCloseTo(4195.5, 6);
  });

  it("writes dollars the way the tester note does", () => {
    expect(claimLadderUsd().map((r) => ladderDollars(r.usd))).toEqual(["$0.50", "$1", "$1.50", "$2.50", "$4"]);
  });

  it("knows the tier names, and the leaf numbers follow TIERS' order", () => {
    expect(TIERS.map((t) => TIER_INDEX[t.name])).toEqual([0, 1, 2, 3, 4]);
    expect(isTier("Rare")).toBe(true);
    expect(isTier("Epic")).toBe(false);
    expect(isTier(2)).toBe(false);
  });
});

describe("the fee from the chain's numbers", () => {
  const base = 2_110_000n * 10n ** 18n;
  const bps = [10_000, 20_000, 30_000, 50_000, 80_000];

  it("is the base times the tier's multiplier, rounded down as Words.claimFee does", () => {
    expect(claimFeeWei(base, bps, "Common")).toBe(base);
    expect(claimFeeWei(base, bps, "Mythic")).toBe(base * 8n);
    expect(claimFeeWei(7n, [10_000, 15_000, 30_000, 50_000, 80_000], "Uncommon")).toBe(10n); // 10.5 → 10
    expect(claimFeeWord(2_110_000, bps, "Legendary")).toBe(10_550_000);
  });

  it("is the base for every tier on a Words without the ladder", () => {
    for (const t of TIERS) {
      expect(claimFeeWei(base, null, t.name)).toBe(base);
      expect(claimFeeWord(2_110_000, null, t.name)).toBe(2_110_000);
    }
  });

  it("follows a multiplier the owner changed", () => {
    expect(claimFeeWord(100, [10_000, 20_000, 40_000, 50_000, 80_000], "Rare")).toBe(400);
  });
});

describe("claim revenue by tier (the console's Treasury tab)", () => {
  it("sums each tier's claims and fees, and the whole", () => {
    const W = 10n ** 18n;
    const r = sumClaimRevenue([
      { tier: 0, fee: 2n * W },
      { tier: 0, fee: 2n * W },
      { tier: 4, fee: 16n * W },
      { tier: 9, fee: 99n * W }, // not a tier: left out
    ]);
    expect(r.byTier.Common).toEqual({ claims: 2, word: 4 });
    expect(r.byTier.Mythic).toEqual({ claims: 1, word: 16 });
    expect(r.byTier.Rare).toEqual({ claims: 0, word: 0 });
    expect(r.claims).toBe(3);
    expect(r.word).toBe(20);
  });
});

describe("where the ladder is live", () => {
  it("in the practice game (no suite), yes", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "8453");
    const { claimLadderLive } = await import("@/lib/claimFee");
    expect(claimLadderLive()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("on Base Sepolia until the registry records a Words with it, no", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
    const { claimLadderLive } = await import("@/lib/claimFee");
    const { wordsHaveClaimTiers } = await import("@/lib/onchain/addresses");
    expect(wordsHaveClaimTiers()).toBe(false);
    expect(claimLadderLive()).toBe(false);
    vi.unstubAllEnvs();
  });
});
