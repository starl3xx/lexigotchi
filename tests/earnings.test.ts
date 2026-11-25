/**
 * What a player's words have earned (src/lib/rewards/earnings.ts) and which shares the keeper still
 * owes (src/lib/keeper/claimables.ts shareStatuses, src/lib/keeper/payout.ts): the sums the Earnings
 * sheet shows, and the plan the payout job sends.
 */
import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { bountyPayDay, earningsJson, latestOpenDay, summarizeEarnings, type LeafStatus } from "@/lib/rewards/earnings";
import { epochKey, shareStatuses, type Claimable, type EpochState } from "@/lib/keeper/claimables";
import { PAYOUT_BATCH, payoutBatches, payoutCalls } from "@/lib/keeper/payout";
import { merkleEpochsAbi } from "@/lib/onchain/abis";

const ME = "0x00000000000000000000000000000000000000aa";
const leaf = (o: Partial<LeafStatus>): LeafStatus => ({
  stream: "yield",
  epochId: "100",
  tokenId: "1",
  account: ME,
  amount: 10n,
  paid: true,
  ...o,
});

describe("summarizeEarnings", () => {
  it("adds up each word's days, what's waiting, and what the latest payout day brought", () => {
    const s = summarizeEarnings(
      [
        leaf({ epochId: "99", amount: 10n }),
        leaf({ epochId: "100", amount: 12n }),
        leaf({ epochId: "100", tokenId: "2", amount: 40n, paid: false }),
        leaf({ epochId: "98", tokenId: "2", amount: 30n }),
      ],
      100,
    );
    expect(s.words.map((w) => [w.tokenId, w.total, w.waiting, w.latest, w.days])).toEqual([
      ["2", 70n, 40n, 40n, 2],
      ["1", 22n, 0n, 12n, 2],
    ]);
    expect([s.yieldTotal, s.yieldLatest, s.waiting, s.total]).toEqual([92n, 52n, 40n, 92n]);
  });

  it("counts a bounty week in the latest payout when it settled that same morning (Bugbot on #177)", () => {
    // week 2968 pays on day (2968 + 1) × 7 = 20783; week 2967 paid a week earlier
    const s = summarizeEarnings(
      [
        leaf({ epochId: "20783", amount: 10n }),
        leaf({ stream: "bounty", epochId: "2968", amount: 50n }),
        leaf({ stream: "bounty", epochId: "2967", amount: 7n }),
      ],
      20783,
    );
    expect(bountyPayDay(2968)).toBe(20783);
    expect([s.yieldLatest, s.latest, s.bountyTotal]).toEqual([10n, 60n, 57n]);
    expect(summarizeEarnings([leaf({ stream: "bounty", epochId: "2968", amount: 50n })], 20784).latest).toBe(0n);
  });

  it("keeps the bounty apart from the words' daily earnings, and in the totals", () => {
    const s = summarizeEarnings([leaf({ amount: 5n }), leaf({ stream: "bounty", epochId: "14", amount: 50n, paid: false })], 100);
    expect(s.words).toHaveLength(1);
    expect([s.bountyTotal, s.yieldTotal, s.total, s.waiting]).toEqual([50n, 5n, 55n, 50n]);
  });

  it("counts a share that can never be paid nowhere", () => {
    const s = summarizeEarnings([leaf({ amount: 5n }), leaf({ epochId: "50", amount: 99n, paid: false, dead: true })], 100);
    expect([s.total, s.waiting, s.words[0].days]).toEqual([5n, 0n, 1]);
  });

  it("with no payout day known, nothing is the latest", () => {
    const s = summarizeEarnings([leaf({})], null);
    expect([s.yieldLatest, s.words[0].latest, s.latestDay]).toEqual([0n, 0n, null]);
  });

  it("serializes every amount as a decimal string", () => {
    const j = earningsJson(summarizeEarnings([leaf({ amount: 10n ** 24n })], 100));
    expect(j.total).toBe("1000000000000000000000000");
    expect(j.words[0].latest).toBe("1000000000000000000000000");
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
});

describe("latestOpenDay", () => {
  it("is the newest day the chain opened, or null", () => {
    expect(latestOpenDay([10, 9, 8], [false, true, true])).toBe(9);
    expect(latestOpenDay([10, 9], [false, false])).toBeNull();
  });
});

const share = (o: Partial<Claimable>): Claimable => ({
  stream: "yield",
  epochId: "100",
  tokenId: "1",
  account: ME,
  amount: "10",
  proof: [],
  ...o,
});

describe("shareStatuses", () => {
  it("marks an unpaid share in an epoch with nothing left as dead, never a paid one", () => {
    const epochs = new Map<string, EpochState>([
      [epochKey("yield", "100"), { open: true, root: "0x1", spent: false }],
      [epochKey("yield", "7"), { open: true, root: "0x2", spent: true }],
    ]);
    const s = shareStatuses([share({}), share({ epochId: "7" }), share({ epochId: "7", tokenId: "2" })], [false, false, true], epochs);
    expect(s.map((x) => [x.epochId, x.tokenId, x.paid, x.dead])).toEqual([
      ["100", "1", false, false],
      ["7", "1", false, true],
      ["7", "2", true, false],
    ]);
  });
});

describe("payout plan", () => {
  it("batches oldest epoch first, every share once", () => {
    const many = Array.from({ length: PAYOUT_BATCH + 5 }, (_, i) => share({ epochId: String(200 - (i % 3)), tokenId: String(i) }));
    const batches = payoutBatches(many);
    expect(batches.map((b) => b.length)).toEqual([PAYOUT_BATCH, 5]);
    expect(batches.flat()).toHaveLength(many.length);
    expect(new Set(batches.flat().map((s) => s.tokenId)).size).toBe(many.length);
    expect(batches[0][0].epochId).toBe("198");
  });

  it("each call claims one share for its own account, and may fail alone", () => {
    const yieldAddr = "0x00000000000000000000000000000000000000a1";
    const bountyAddr = "0x00000000000000000000000000000000000000b1";
    const calls = payoutCalls([share({ amount: "123", proof: ["0x" + "11".repeat(32)] as `0x${string}`[] }), share({ stream: "bounty", epochId: "14" })], (s) =>
      s === "yield" ? yieldAddr : bountyAddr,
    );
    expect(calls.map((c) => [c.target, c.allowFailure])).toEqual([
      [yieldAddr, true],
      [bountyAddr, true],
    ]);
    const d = decodeFunctionData({ abi: merkleEpochsAbi, data: calls[0].callData });
    expect(d.functionName).toBe("claim");
    expect(d.args).toEqual([100n, 1n, getAddress(ME), 123n, ["0x" + "11".repeat(32)]]);
  });
});
