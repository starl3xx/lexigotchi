import { describe, it, expect } from "vitest";
import { yieldLeaves, bountyLeaves, leavesTotal, type KeeperWord } from "@/lib/keeper/shares";
import { buildEpochFile, verifyEntry } from "@/lib/keeper/tree";
import { DEFAULT_PARAMS } from "@/lib/params";
import { TIER_WEIGHT, wordTier } from "@/lib/economy";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

// secondsUnfed defaults to whatever daysUnfed says, so a fixture can set either one and the two
// stay consistent — the same invariant scanAllWords maintains by deriving days from seconds.
const mk = (over: Partial<KeeperWord>): KeeperWord => {
  const base = {
    tokenId: 1n,
    word: "ABOUT",
    owner: A,
    staked: true,
    daysUnfed: 0,
    prestigeLevel: 0,
    upperAll: true,
    ...over,
  };
  return { ...base, secondsUnfed: over.secondsUnfed ?? base.daysUnfed * 86_400 };
};

const POT = 10n ** 18n; // 1 $WORD

describe("yieldLeaves — the daily UPPERCASE yield split", () => {
  it("pays only staked, fully-UPPERCASE words", () => {
    const leaves = yieldLeaves(
      [
        mk({ tokenId: 1n }),
        mk({ tokenId: 2n, staked: false }),
        mk({ tokenId: 3n, upperAll: false }),
      ],
      POT,
    );
    expect(leaves.map((l) => l.tokenId)).toEqual([1n]);
    expect(leaves[0].amount).toBe(POT); // the only eligible word takes the whole pot
  });

  it("halves peckish words and drops hungry ones — the care loop's teeth", () => {
    const p = DEFAULT_PARAMS;
    const leaves = yieldLeaves(
      [
        mk({ tokenId: 1n, daysUnfed: 0 }),
        mk({ tokenId: 2n, daysUnfed: p.care.peckishAfterDays, owner: B }),
        mk({ tokenId: 3n, daysUnfed: p.care.hungryAfterDays }),
      ],
      POT,
    );
    expect(leaves).toHaveLength(2); // hungry word gone
    const fed = leaves.find((l) => l.tokenId === 1n)!;
    const peckish = leaves.find((l) => l.tokenId === 2n)!;
    // Same word, same tier — the fed one earns exactly double the peckish one.
    expect(fed.amount).toBe(peckish.amount * 2n);
  });

  it("weights by tier exactly as the sim does", () => {
    // Two words of different tiers, both fed: split ∝ TIER_WEIGHT.
    const wA = "ABOUT"; // whatever tiers these are, the ratio must match TIER_WEIGHT
    const wB = "JAZZY";
    const leaves = yieldLeaves(
      [mk({ tokenId: 1n, word: wA }), mk({ tokenId: 2n, word: wB, owner: B })],
      10n ** 24n, // big pot so integer rounding noise vanishes
    );
    const ratio = Number(leaves.find((l) => l.tokenId === 2n)!.amount) / Number(leaves.find((l) => l.tokenId === 1n)!.amount);
    const expected = TIER_WEIGHT[wordTier(wB)] / TIER_WEIGHT[wordTier(wA)];
    expect(ratio).toBeCloseTo(expected, 3);
  });

  it("prestige multiplies the slice, never the pot", () => {
    const leaves = yieldLeaves(
      [mk({ tokenId: 1n }), mk({ tokenId: 2n, prestigeLevel: 1, owner: B })],
      10n ** 24n,
    );
    const ratio = Number(leaves.find((l) => l.tokenId === 2n)!.amount) / Number(leaves.find((l) => l.tokenId === 1n)!.amount);
    expect(ratio).toBeCloseTo(DEFAULT_PARAMS.prestige.yieldMultPerLevel, 3);
    expect(leavesTotal(leaves) <= 10n ** 24n).toBe(true);
  });

  it("NEVER exceeds the pot — overpayment bricks the epoch's last claims on-chain", () => {
    const words = Array.from({ length: 37 }, (_, i) =>
      mk({ tokenId: BigInt(i + 1), daysUnfed: i % 2, prestigeLevel: i % 3, owner: i % 2 ? A : B }),
    );
    const total = leavesTotal(yieldLeaves(words, POT));
    expect(total <= POT).toBe(true);
    // dust only: strictly less than one wei per leaf
    expect(POT - total < 37n).toBe(true);
  });

  it("is deterministic and tokenId-ordered — the published tree must be reproducible", () => {
    const words = [mk({ tokenId: 5n }), mk({ tokenId: 2n, owner: B }), mk({ tokenId: 9n })];
    const a = yieldLeaves(words, POT);
    const b = yieldLeaves([...words].reverse(), POT);
    expect(a).toEqual(b);
    expect(a.map((l) => l.tokenId)).toEqual([2n, 5n, 9n]);
  });
});

describe("bountyLeaves — the theme bounty split", () => {
  const isRare = (w: string) => /[QZXJ]/.test(w);

  it("pays staked matching words regardless of case — the casual-reach virtue", () => {
    const leaves = bountyLeaves(
      [
        mk({ tokenId: 1n, word: "JAZZY", upperAll: false }), // lowercase still counts
        mk({ tokenId: 2n, word: "ABOUT" }), // no rare letter → out
        mk({ tokenId: 3n, word: "QUERY", staked: false }), // unstaked → out
      ],
      POT,
      isRare,
    );
    expect(leaves.map((l) => l.tokenId)).toEqual([1n]);
  });

  it("respects requiresNotHungry from params", () => {
    const p = DEFAULT_PARAMS;
    const hungry = mk({ tokenId: 1n, word: "JAZZY", daysUnfed: p.care.hungryAfterDays });
    const leaves = bountyLeaves([hungry], POT, isRare, p);
    expect(leaves.length).toBe(p.bounty.requiresNotHungry ? 0 : 1);
  });
});

describe("buildEpochFile — the tree the contract will verify", () => {
  it("round-trips every proof against its own root", () => {
    const leaves = yieldLeaves(
      Array.from({ length: 9 }, (_, i) => mk({ tokenId: BigInt(i + 1), owner: i % 2 ? A : B })),
      POT,
    );
    const epoch = buildEpochFile(leaves);
    expect(epoch.entries).toHaveLength(9);
    expect(BigInt(epoch.total)).toBe(leavesTotal(leaves));
    for (const e of epoch.entries) expect(verifyEntry(epoch.root, e)).toBe(true);
    // and a tampered amount must fail
    const forged = { ...epoch.entries[0], amount: (BigInt(epoch.entries[0].amount) + 1n).toString() };
    expect(verifyEntry(epoch.root, forged)).toBe(false);
  });
});
