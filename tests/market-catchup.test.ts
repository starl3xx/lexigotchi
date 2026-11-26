/**
 * The sales reader hands out each sale it is the FIRST to record, as it records it
 * (lib/market/sales.ts `catchUpSales`, `onNew`). Sellers are told from that hand-out
 * (lib/notify/sold.ts), and a row is only ever new once: so a pass that fails part way must already
 * have handed out what it recorded, or those sellers are never told.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SALE_FEES = "0x00000000000000000000000000000000000000f1";
const tx = (i: number) => `0x${String(i).padStart(64, "0")}` as const;
const chain = vi.hoisted(() => ({ receipts: new Map<string, unknown>(), recorded: [] as unknown[][], marked: [] as number[] }));

vi.mock("@/lib/onchain/addresses", () => ({
  maybeAddressOf: () => SALE_FEES,
  addressOf: () => SALE_FEES,
  wordTokenAddress: () => "0x00000000000000000000000000000000000000f2",
  deployBlock: () => 0n,
}));
vi.mock("@/lib/onchain/reads", () => ({
  getPublicClient: () => ({
    getBlockNumber: async () => 500n,
    getLogs: async () => [{ transactionHash: tx(1) }, { transactionHash: tx(2) }, { transactionHash: tx(3) }],
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const r = chain.receipts.get(hash);
      if (!r) throw new Error("the RPC has no receipt for that transaction yet");
      return r;
    },
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
  }),
}));
vi.mock("@/lib/db/shop", () => ({ indexedThrough: async () => null, markIndexed: async (_c: number, _a: string, to: number) => void chain.marked.push(to) }));
// Each receipt "holds" one sale: the recorder is the database's side, so it stands in here.
vi.mock("@/lib/db/market", () => ({
  recordNewSales: async () => {
    const row = { txHash: tx(chain.recorded.length + 1), logIndex: 1 };
    chain.recorded.push([row]);
    return [row];
  },
  recordSales: async () => 0,
}));

const { catchUpSales } = await import("@/lib/market/sales");
const receipt = (i: number) => ({ status: "success", blockNumber: 100n + BigInt(i), logs: [], transactionHash: tx(i) });

beforeEach(() => {
  chain.receipts.clear();
  chain.recorded.length = 0;
  chain.marked.length = 0;
});

describe("catchUpSales", () => {
  it("hands out every sale it records, and says how many", async () => {
    for (const i of [1, 2, 3]) chain.receipts.set(tx(i), receipt(i));
    const got: unknown[] = [];
    const res = await catchUpSales({ onNew: (rows) => void got.push(...rows) });
    expect(res).toEqual({ recorded: 3, through: 500 });
    expect(got).toHaveLength(3);
    expect(chain.marked).toEqual([500]);
  });

  it("has already handed out what it recorded when a later read throws", async () => {
    chain.receipts.set(tx(1), receipt(1));
    chain.receipts.set(tx(2), receipt(2));
    // the third receipt isn't served yet: the pass ends here, and the cursor doesn't move past it
    const got: unknown[] = [];
    await expect(catchUpSales({ onNew: (rows) => void got.push(...rows) })).rejects.toThrow(/no receipt/);
    expect(got).toHaveLength(2);
    expect(chain.marked).toEqual([]);
  });

  it("works with nobody listening", async () => {
    chain.receipts.set(tx(1), receipt(1));
    chain.receipts.set(tx(2), receipt(2));
    chain.receipts.set(tx(3), receipt(3));
    expect((await catchUpSales())?.recorded).toBe(3);
  });
});
