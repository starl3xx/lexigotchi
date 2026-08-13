import { describe, it, expect, beforeAll } from "vitest";

// The order builder resolves the Letters address from the registry — point it at Sepolia BEFORE
// the module loads (mainnet's registry is empty until launch).
beforeAll(() => { process.env.NEXT_PUBLIC_CHAIN_ID = "84532"; });
const load = async () => await import("@/lib/onchain/seaport");

const MAKER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const base = { maker: MAKER, giveId: 16, wantId: 25, counter: 0n, nowSeconds: 1_755_000_000, salt: 42n } as const;

describe("buildLetterSwapOrder — the fixed 1⇄1 shape", () => {
  it("offers exactly one letter and asks exactly one, back to the maker", async () => {
    const { buildLetterSwapOrder } = await load();
    const o = buildLetterSwapOrder(base);
    expect(o.offer).toHaveLength(1);
    expect(o.consideration).toHaveLength(1);
    expect(o.offer[0].itemType).toBe(3); // ERC1155
    expect(o.offer[0].identifierOrCriteria).toBe("16");
    expect(o.consideration[0].identifierOrCriteria).toBe("25");
    expect(o.consideration[0].recipient).toBe(MAKER); // the maker gets paid, whoever fills
    expect(o.orderType).toBe(0); // FULL_OPEN — no zone games
    expect(o.conduitKey).toMatch(/^0x0+$/); // direct approvals to Seaport, no conduit
  });

  it("is deterministic for fixed inputs — same order, same signature-payload, byte for byte", async () => {
    const { buildLetterSwapOrder, orderTypedData } = await load();
    expect(buildLetterSwapOrder(base)).toEqual(buildLetterSwapOrder({ ...base }));
    expect(JSON.stringify(orderTypedData(buildLetterSwapOrder(base))))
      .toBe(JSON.stringify(orderTypedData(buildLetterSwapOrder({ ...base }))));
  });

  it("expires — a stale board clears itself", async () => {
    const { buildLetterSwapOrder } = await load();
    const o = buildLetterSwapOrder(base);
    expect(Number(o.endTime) - Number(o.startTime)).toBe(30 * 24 * 3600);
  });
});

describe("call builders target Seaport with the right selectors", () => {
  it("fulfillOrder", async () => {
    const { buildLetterSwapOrder, fulfillOrderCalls, SEAPORT } = await load();
    const [call] = fulfillOrderCalls(buildLetterSwapOrder(base), "0xdeadbeef");
    expect(call.to).toBe(SEAPORT);
    expect(call.data?.startsWith("0xb3a34c4c")).toBe(true); // fulfillOrder selector
  });
  it("cancel", async () => {
    const { buildLetterSwapOrder, cancelOrderCalls, SEAPORT } = await load();
    const [call] = cancelOrderCalls(buildLetterSwapOrder(base));
    expect(call.to).toBe(SEAPORT);
    expect(call.data?.startsWith("0xfd9f1e10")).toBe(true); // cancel selector
  });
});
