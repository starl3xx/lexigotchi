/**
 * traceSend (src/lib/onchain/traceSend.ts): when a send's effect never shows, ask the game's chain
 * (and, for a batch, the wallet) what happened, instead of having said "sent" and stopping there.
 */
import { describe, it, expect } from "vitest";
import { traceSend, type TraceDeps } from "@/lib/onchain/traceSend";

const A = `0x${"a".repeat(64)}`;
const B = `0x${"b".repeat(64)}`;
const SEPOLIA = 84532;

/** A fake chain: `mined` maps a hash to its receipt status, `pending` lists hashes seen but not mined. */
function chain(
  opts: {
    mined?: Record<string, "success" | "reverted">;
    pending?: string[];
    calls?: unknown;
    callsThrow?: boolean;
    /** The wallet never answers wallet_getCallsStatus (a backgrounded WalletConnect phone). */
    callsHang?: boolean;
  } = {},
): TraceDeps {
  return {
    chainId: SEPOLIA,
    walletTimeoutMs: 20,
    receipt: async (h) => (opts.mined?.[h] ? { status: opts.mined[h] } : null),
    known: async (h) => !!opts.mined?.[h] || !!opts.pending?.includes(h),
    callsStatus: async () => {
      if (opts.callsThrow) throw new Error("Method not supported");
      if (opts.callsHang) return new Promise(() => {});
      return opts.calls;
    },
  };
}

describe("traceSend: plain transactions", () => {
  it("says landed when the hash mined and succeeded", async () => {
    const t = await traceSend({ via: "sendTransaction", hashes: [A] }, chain({ mined: { [A]: "success" } }));
    expect(t).toEqual({ kind: "landed", hash: A });
  });

  it("says reverted when the hash mined and failed", async () => {
    const t = await traceSend({ via: "sendTransaction", hashes: [A] }, chain({ mined: { [A]: "reverted" } }));
    expect(t).toEqual({ kind: "reverted", hash: A });
  });

  it("says pending when the chain knows the hash but hasn't mined it", async () => {
    const t = await traceSend({ via: "sendTransaction", hashes: [A] }, chain({ pending: [A] }));
    expect(t).toEqual({ kind: "pending", hash: A });
  });

  it("says unseen when the game's chain has never heard of the hash", async () => {
    const t = await traceSend({ via: "sendTransaction", hashes: [A] }, chain());
    expect(t).toEqual({ kind: "unseen", hash: A });
  });

  it("reports the first hash that did not land", async () => {
    const t = await traceSend({ via: "sendTransaction", hashes: [A, B] }, chain({ mined: { [A]: "success" } }));
    expect(t).toEqual({ kind: "unseen", hash: B });
  });

  it("says unknown when a read fails, never unseen", async () => {
    const deps = { ...chain(), known: async () => { throw new Error("rpc down"); } };
    expect(await traceSend({ via: "sendTransaction", hashes: [A] }, deps)).toEqual({ kind: "unknown" });
  });
});

describe("traceSend: wallet_sendCalls batches", () => {
  it("names another chain when the wallet ran the batch elsewhere", async () => {
    const t = await traceSend({ via: "sendCalls", id: "x" }, chain({ calls: { status: 200, chainId: "0x2105", receipts: [] } }));
    expect(t).toEqual({ kind: "other_chain", chainId: 8453 });
  });

  it("checks the receipts' hashes on the game's chain, even when the wallet says confirmed", async () => {
    const t = await traceSend(
      { via: "sendCalls", id: "x" },
      chain({ calls: { status: 200, receipts: [{ transactionHash: A, status: "0x1" }] } }),
    );
    expect(t).toEqual({ kind: "unseen", hash: A });
  });

  it("finds a reverted batch through its receipt", async () => {
    const t = await traceSend(
      { via: "sendCalls", id: "x" },
      chain({ mined: { [A]: "reverted" }, calls: { status: 500, chainId: "0x14a34", receipts: [{ transactionHash: A }] } }),
    );
    expect(t).toEqual({ kind: "reverted", hash: A });
  });

  it("reads both status shapes for a pending batch", async () => {
    expect(await traceSend({ via: "sendCalls", id: "x" }, chain({ calls: { status: 100 } }))).toEqual({ kind: "wallet_pending" });
    expect(await traceSend({ via: "sendCalls", id: "x" }, chain({ calls: { status: "PENDING" } }))).toEqual({ kind: "wallet_pending" });
  });

  it("says the wallet failed it when the batch failed with no receipt", async () => {
    const t = await traceSend({ via: "sendCalls", id: "x" }, chain({ calls: { status: 400, chainId: "0x14a34" } }));
    expect(t).toEqual({ kind: "wallet_failed" });
  });

  it("says unknown when the wallet can't answer wallet_getCallsStatus", async () => {
    expect(await traceSend({ via: "sendCalls", id: "x" }, chain({ callsThrow: true }))).toEqual({ kind: "unknown" });
  });

  it("says unknown with nothing to trace", async () => {
    expect(await traceSend(undefined, chain())).toEqual({ kind: "unknown" });
    expect(await traceSend({ via: "sendCalls" }, chain({ calls: { status: 200 } }))).toEqual({ kind: "unknown" });
  });

  // A smart wallet's receipt hash is the bundler's handleOps transaction, which succeeds onchain
  // even when the operation inside it reverts. The wallet's verdict must win.
  it("believes the wallet's failure over a bundle that landed", async () => {
    const failedBatch = chain({ mined: { [A]: "success" }, calls: { status: 500, chainId: "0x14a34", receipts: [{ transactionHash: A, status: "0x1" }] } });
    expect(await traceSend({ via: "sendCalls", id: "x" }, failedBatch)).toEqual({ kind: "reverted", hash: A });

    const failedReceipt = chain({ mined: { [A]: "success" }, calls: { status: 200, chainId: "0x14a34", receipts: [{ transactionHash: A, status: "0x0" }] } });
    expect(await traceSend({ via: "sendCalls", id: "x" }, failedReceipt)).toEqual({ kind: "reverted", hash: A });
  });

  it("reads a decimal chainId as decimal", async () => {
    const t = await traceSend(
      { via: "sendCalls", id: "x" },
      chain({ mined: { [A]: "success" }, calls: { status: 200, chainId: "84532", receipts: [{ transactionHash: A, status: "0x1" }] } }),
    );
    expect(t).toEqual({ kind: "landed", hash: A });
  });

  it("trusts receipts found on the game's chain over a chainId that disagrees", async () => {
    const t = await traceSend(
      { via: "sendCalls", id: "x" },
      chain({ mined: { [A]: "success" }, calls: { status: 200, chainId: "0x2105", receipts: [{ transactionHash: A, status: "0x1" }] } }),
    );
    expect(t).toEqual({ kind: "landed", hash: A });
  });

  it("gives up on a wallet that never answers, instead of holding the action", async () => {
    expect(await traceSend({ via: "sendCalls", id: "x" }, chain({ callsHang: true }))).toEqual({ kind: "unknown" });
  });
});
