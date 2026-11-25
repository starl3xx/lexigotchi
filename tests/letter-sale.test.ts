/**
 * Selling letters (decisions.md #28): the order the app signs, and the checker the board's server runs
 * on every listing. A buyer may take any number of the letters, and Seaport fills a part only when
 * every amount divides, so each payment must be a whole per-letter amount times the quantity. What
 * Seaport itself does with these orders is checked on a fork (scripts/market-fork-check.ts).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import sepolia from "../config/deployments.base-sepolia.json";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

let L: typeof import("@/lib/onchain/letterSale");
let S: typeof import("@/lib/onchain/seaport");
beforeAll(async () => {
  L = await import("@/lib/onchain/letterSale");
  S = await import("@/lib/onchain/seaport");
});

const MAKER = "0x1111111111111111111111111111111111111111" as const;
const NOW = 1_795_000_000;
const WEI = 10n ** 18n;
const ctx = () => ({ letters: sepolia.contracts.letters, word: sepolia.wordToken, saleFees: sepolia.contracts.saleFees, nowSeconds: NOW });
const order = (qty = 5, unitWhole = 40_000n, letterId = 22) =>
  L.buildLetterSaleOrder({ maker: MAKER, letterId, qty, unitPriceWei: unitWhole * WEI, counter: 0n, nowSeconds: NOW, salt: 7n });

describe("the letter-sale order", () => {
  it("offers the letters, and pays the seller 90% and SaleFees 10% of every letter", () => {
    const o = order();
    expect(o.offer).toEqual([{ itemType: 3, token: sepolia.contracts.letters, identifierOrCriteria: "22", startAmount: "5", endAmount: "5" }]);
    expect(o.consideration[0].recipient).toBe(MAKER);
    expect(o.consideration[0].startAmount).toBe(String(36_000n * WEI * 5n));
    expect(o.consideration[1].recipient.toLowerCase()).toBe(sepolia.contracts.saleFees.toLowerCase());
    expect(o.consideration[1].startAmount).toBe(String(4_000n * WEI * 5n));
    expect(o.orderType).toBe(1); // PARTIAL_OPEN: anyone, any part
    expect(L.checkLetterSaleOrder(o, ctx())).toEqual({ ok: true, letterId: 22, qty: 5, unitPriceWei: 40_000n * WEI, unitFeeWei: 4_000n * WEI });
  });

  it("splits the fee per letter, rounded up, so every part of the order is a whole amount", () => {
    expect(L.splitUnitPrice(1001n)).toEqual({ feeWei: 101n, sellerWei: 900n });
    // 3 letters at an awkward price: both payments still divide by 3.
    const o = L.buildLetterSaleOrder({ maker: MAKER, letterId: 0, qty: 3, unitPriceWei: 100n * WEI + 5n, counter: 0n, nowSeconds: NOW, salt: 1n });
    for (const p of o.consideration) expect(BigInt(p.startAmount) % 3n).toBe(0n);
    expect(L.checkLetterSaleOrder(o, ctx()).ok).toBe(true);
  });

  it("lasts 30 days", () => {
    const o = order();
    expect(Number(o.endTime) - Number(o.startTime)).toBe(30 * 24 * 3600);
  });
});

describe("the board's checker", () => {
  const refuses = (change: (o: ReturnType<typeof order>) => void, error: string) => {
    const o = order();
    change(o);
    expect(L.checkLetterSaleOrder(o, ctx())).toEqual({ ok: false, error });
  };

  it("refuses payments that don't divide by the quantity", () => {
    refuses((o) => {
      // The fee split on the total of 3 letters, the way a word's fee is split: no whole third.
      const total = (100n * WEI + 5n) * 3n;
      const fee = (total * 1_000n + 9_999n) / 10_000n;
      o.offer[0].startAmount = o.offer[0].endAmount = "3";
      o.consideration[0].startAmount = o.consideration[0].endAmount = String(total - fee);
      o.consideration[1].startAmount = o.consideration[1].endAmount = String(fee);
    }, "uneven_price");
  });

  it("refuses a fee under 10% of a letter, or paid to anyone but SaleFees", () => {
    refuses((o) => {
      o.consideration[0].startAmount = o.consideration[0].endAmount = String(37_000n * WEI * 5n);
      o.consideration[1].startAmount = o.consideration[1].endAmount = String(3_000n * WEI * 5n);
    }, "bad_fee");
    refuses((o) => void (o.consideration[1].recipient = MAKER), "bad_fee");
  });

  it("refuses a price under the minimum for a letter", () => {
    const o = L.buildLetterSaleOrder({ maker: MAKER, letterId: 3, qty: 2, unitPriceWei: BigInt(L.MIN_LETTER_PRICE - 1) * WEI, counter: 0n, nowSeconds: NOW, salt: 1n });
    expect(L.checkLetterSaleOrder(o, ctx())).toEqual({ ok: false, error: "price_too_low" });
  });

  it("refuses anything but letters for $WORD, in parts, with no zone", () => {
    refuses((o) => void (o.offer[0].token = sepolia.contracts.words as `0x${string}`), "bad_offer");
    refuses((o) => void (o.offer[0].itemType = 2), "bad_offer");
    refuses((o) => void (o.offer[0].identifierOrCriteria = "52"), "bad_letter");
    refuses((o) => void (o.offer[0].startAmount = o.offer[0].endAmount = "0"), "bad_quantity");
    refuses((o) => void (o.offer[0].startAmount = o.offer[0].endAmount = String(L.MAX_LETTER_QTY + 1)), "bad_quantity");
    refuses((o) => void (o.offer[0].endAmount = "4"), "bad_offer");
    refuses((o) => void (o.consideration[0].token = sepolia.contracts.words as `0x${string}`), "bad_payment");
    refuses((o) => void (o.consideration[0].recipient = "0x2222222222222222222222222222222222222222"), "bad_payment");
    refuses((o) => void o.consideration.pop(), "bad_payment");
    refuses((o) => void (o.orderType = 0), "bad_order"); // a full-only order can't sell one of five
    refuses((o) => void (o.zone = MAKER), "bad_order");
  });

  it("refuses an order that has ended, starts later, or runs past 30 days", () => {
    refuses((o) => void (o.endTime = String(NOW)), "bad_window");
    refuses((o) => void (o.startTime = String(NOW + 3_600)), "bad_window");
    refuses((o) => void (o.endTime = String(NOW + 60 * 24 * 3600)), "bad_window");
  });
});

describe("how many are left", () => {
  it("reads Seaport's fraction in any terms", () => {
    expect(L.unsoldLetters(5, 0n, 0n)).toBe(5); // never filled
    expect(L.unsoldLetters(5, 2n, 5n)).toBe(3);
    expect(L.unsoldLetters(5, 4n, 10n)).toBe(3); // the same fraction, kept in other terms
    expect(L.unsoldLetters(5, 5n, 5n)).toBe(0);
    expect(L.unsoldLetters(1, 1n, 1n)).toBe(0);
  });
  it("never offers a letter that is partly accounted for", () => {
    expect(L.unsoldLetters(5, 1n, 3n)).toBe(3); // 1.67 sold rounds up to 2
    expect(L.unsoldLetters(5, 9n, 5n)).toBe(0); // more than whole: nothing left, never negative
  });
});

describe("the calls", () => {
  it("prices a part of the order by the letter", () => {
    const o = order(5, 40_000n);
    expect(L.lettersPriceWei(o, 1)).toBe(40_000n * WEI);
    expect(L.lettersPriceWei(o, 3)).toBe(120_000n * WEI);
  });

  it("buying approves exactly the price of what is taken, then fills that part", () => {
    const o = order(5, 40_000n);
    const calls = L.buyLettersCalls(o, "0xdeadbeef", 2, 0n);
    expect(calls).toHaveLength(2);
    expect(calls[0].to.toLowerCase()).toBe(sepolia.wordToken.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data! }).args).toEqual([S.SEAPORT, 80_000n * WEI]);
    expect(calls[1].to).toBe(S.SEAPORT);
    expect(calls[1].data?.startsWith("0xe7acab24")).toBe(true); // fulfillAdvancedOrder
    const fill = decodeFunctionData({ abi: S.seaportAbi, data: calls[1].data! });
    const [advanced, resolvers, conduit, recipient] = fill.args as unknown as [{ numerator: bigint; denominator: bigint; signature: string; parameters: { orderType: number; totalOriginalConsiderationItems: bigint } }, unknown[], string, string];
    expect([advanced.numerator, advanced.denominator]).toEqual([2n, 5n]);
    expect(advanced.parameters.orderType).toBe(1);
    expect(advanced.parameters.totalOriginalConsiderationItems).toBe(2n);
    expect(resolvers).toEqual([]);
    expect(BigInt(conduit)).toBe(0n);
    expect(BigInt(recipient)).toBe(0n); // the caller receives the letters
  });

  it("skips the approval when Seaport may already spend that much", () => {
    expect(L.buyLettersCalls(order(), "0xdeadbeef", 2, 80_000n * WEI)).toHaveLength(1);
  });

  it("listing cancels the earlier orders for the letter, and approves Letters once", () => {
    const old = order(3, 50_000n);
    const calls = L.prepareLetterListingCalls([old], false);
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(S.SEAPORT);
    expect(calls[0].data?.startsWith("0xfd9f1e10")).toBe(true); // cancel
    expect(calls[1].to.toLowerCase()).toBe(sepolia.contracts.letters.toLowerCase());
    expect(L.prepareLetterListingCalls([], true)).toEqual([]);
  });
});
