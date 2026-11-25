/**
 * Selling words (decisions.md #18): the order the app signs, and the checker the board's server runs
 * on every listing. The fee only exists if the signed order carries it, so the checker refuses every
 * order that pays SaleFees less than 10%, or anything but the one fixed shape.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import sepolia from "../config/deployments.base-sepolia.json";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

let W: typeof import("@/lib/onchain/wordSale");
let abis: typeof import("@/lib/onchain/abis");
beforeAll(async () => {
  W = await import("@/lib/onchain/wordSale");
  abis = await import("@/lib/onchain/abis");
});

const MAKER = "0x1111111111111111111111111111111111111111" as const;
const NOW = 1_795_000_000;
const WEI = 10n ** 18n;
const ctx = () => ({ words: sepolia.contracts.words, word: sepolia.wordToken, saleFees: sepolia.contracts.saleFees, nowSeconds: NOW });
const order = (priceWhole = 2_000_000n) =>
  W.buildWordSaleOrder({ maker: MAKER, tokenId: 42n, priceWei: priceWhole * WEI, counter: 0n, nowSeconds: NOW, salt: 7n });

describe("the word-sale order", () => {
  it("pays the seller 90% and SaleFees 10% of the price, and the checker accepts it", () => {
    const o = order();
    expect(o.consideration[0].recipient).toBe(MAKER);
    expect(o.consideration[0].startAmount).toBe(String(1_800_000n * WEI));
    expect(o.consideration[1].recipient.toLowerCase()).toBe(sepolia.contracts.saleFees.toLowerCase());
    expect(o.consideration[1].startAmount).toBe(String(200_000n * WEI));
    expect(W.checkWordSaleOrder(o, ctx())).toEqual({ ok: true, tokenId: 42n, priceWei: 2_000_000n * WEI, feeWei: 200_000n * WEI });
    expect(W.orderPriceWei(o)).toBe(2_000_000n * WEI);
  });

  it("rounds the fee up, so it's never under 10%", () => {
    expect(W.splitPrice(1001n)).toEqual({ feeWei: 101n, sellerWei: 900n });
    expect(W.splitPrice(1000n)).toEqual({ feeWei: 100n, sellerWei: 900n });
  });
});

describe("the board refuses anything else", () => {
  const refuse = (mutate: (o: ReturnType<typeof order>) => void, error: string) => {
    const o = structuredClone(order());
    mutate(o);
    expect(W.checkWordSaleOrder(o, ctx())).toEqual({ ok: false, error });
  };

  it("a fee under 10%, or paid to anyone but SaleFees, or missing", () => {
    refuse((o) => {
      o.consideration[1].startAmount = o.consideration[1].endAmount = String(199_999n * WEI);
    }, "bad_fee");
    refuse((o) => {
      o.consideration[1].recipient = MAKER;
    }, "bad_fee");
    refuse((o) => {
      o.consideration.pop();
    }, "bad_payment");
  });

  it("an extra payment, a payment that changes over time, another token, or the seller not paid", () => {
    refuse((o) => {
      o.consideration.push({ ...o.consideration[1] });
    }, "bad_payment");
    refuse((o) => {
      o.consideration[0].endAmount = "1";
    }, "bad_payment");
    refuse((o) => {
      o.consideration[0].token = "0x2222222222222222222222222222222222222222";
    }, "bad_payment");
    refuse((o) => {
      o.consideration[0].recipient = "0x3333333333333333333333333333333333333333";
    }, "bad_payment");
  });

  it("anything but one Word offered", () => {
    refuse((o) => {
      o.offer[0].itemType = 3;
    }, "bad_offer");
    refuse((o) => {
      o.offer[0].token = sepolia.contracts.letters as `0x${string}`;
    }, "bad_offer");
    refuse((o) => {
      o.offer.push({ ...o.offer[0] });
    }, "bad_offer");
  });

  it("a zone, a conduit, a price under the minimum, or a window that's expired or too long", () => {
    refuse((o) => {
      o.zone = "0x4444444444444444444444444444444444444444";
    }, "bad_order");
    refuse((o) => {
      o.conduitKey = `0x${"1".repeat(64)}`;
    }, "bad_order");
    const cheap = order(999n);
    expect(W.checkWordSaleOrder(cheap, ctx())).toEqual({ ok: false, error: "price_too_low" });
    refuse((o) => {
      o.endTime = String(NOW - 1);
    }, "bad_window");
    refuse((o) => {
      o.endTime = String(NOW + 90 * 86_400);
    }, "bad_window");
    expect(W.checkWordSaleOrder(null, ctx())).toEqual({ ok: false, error: "bad_offerer" });
  });
});

describe("the calls", () => {
  it("listing approves this one word to Seaport, after cancelling earlier orders for it", () => {
    const calls = W.prepareListingCalls(42n, [order(3_000_000n)], false);
    expect(calls).toHaveLength(2);
    const approve = decodeFunctionData({ abi: abis.wordsAbi, data: calls[1].data! });
    expect(approve.functionName).toBe("approve");
    expect(approve.args?.[1]).toBe(42n);
    expect(W.prepareListingCalls(42n, [], true)).toEqual([]);
  });

  it("buying approves exactly the price, never more, then fills", () => {
    const o = order();
    const calls = W.buyWordCalls(o, "0x12", 0n);
    expect(calls).toHaveLength(2);
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data! });
    expect(approve.args).toEqual([expect.any(String), 2_000_000n * WEI]);
    expect(W.buyWordCalls(o, "0x12", 2_000_000n * WEI)).toHaveLength(1);
  });
});
