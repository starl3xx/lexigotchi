/**
 * The $WORD swap's rules (src/lib/swap/kyber.ts): which pairs trade, the pinned router, and the
 * minimum the player accepts.
 */
import { describe, it, expect } from "vitest";
import { KYBER_ROUTER, NATIVE, SWAP_TOKENS, checkBuild, minOut, priceImpactPct, symbolOf, validPair } from "@/lib/swap/kyber";

describe("validPair", () => {
  it("trades $WORD against ETH or USDC, either way", () => {
    expect(validPair("ETH", "WORD")).toBe(true);
    expect(validPair("USDC", "WORD")).toBe(true);
    expect(validPair("WORD", "ETH")).toBe(true);
    expect(validPair("WORD", "USDC")).toBe(true);
  });
  it("refuses a pair without $WORD, or a token for itself", () => {
    expect(validPair("ETH", "USDC")).toBe(false);
    expect(validPair("WORD", "WORD")).toBe(false);
  });
});

describe("symbolOf", () => {
  it("knows the three tokens in any case, and nothing else", () => {
    expect(symbolOf("0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913")).toBe("USDC");
    expect(symbolOf("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")).toBe("ETH");
    expect(symbolOf("0x0000000000000000000000000000000000000001")).toBeNull();
  });
});

describe("checkBuild", () => {
  const USDC = SWAP_TOKENS.USDC.address;
  const ok = { routerAddress: KYBER_ROUTER.toLowerCase(), amountIn: "1000000", data: "0xe21fd0e9", transactionValue: "0" };
  it("passes a build for the pinned router and the quoted amount", () => {
    expect(checkBuild(ok, { amountIn: "1000000", tokenIn: USDC })).toBeNull();
    expect(checkBuild({ ...ok, transactionValue: undefined }, { amountIn: "1000000", tokenIn: USDC })).toBeNull();
  });
  it("refuses another router, a changed amount, or bad calldata", () => {
    expect(checkBuild({ ...ok, routerAddress: "0x0000000000000000000000000000000000000bad" }, { amountIn: "1000000", tokenIn: USDC })).toBe("unexpected_router");
    expect(checkBuild(ok, { amountIn: "999", tokenIn: USDC })).toBe("amount_changed");
    expect(checkBuild({ ...ok, data: "not-hex" }, { amountIn: "1000000", tokenIn: USDC })).toBe("bad_calldata");
  });
  it("binds the ETH value: exactly the amount for an ETH sale, nothing for a token sale", () => {
    expect(checkBuild({ ...ok, transactionValue: "1000000" }, { amountIn: "1000000", tokenIn: NATIVE })).toBeNull();
    expect(checkBuild({ ...ok, transactionValue: "0" }, { amountIn: "1000000", tokenIn: NATIVE })).toBe("unexpected_value");
    expect(checkBuild({ ...ok, transactionValue: "2000000" }, { amountIn: "1000000", tokenIn: NATIVE })).toBe("unexpected_value");
    expect(checkBuild({ ...ok, transactionValue: "1" }, { amountIn: "1000000", tokenIn: USDC })).toBe("unexpected_value");
    expect(checkBuild({ ...ok, transactionValue: "0x10" }, { amountIn: "1000000", tokenIn: USDC })).toBe("bad_value");
  });
});

describe("minOut and priceImpactPct", () => {
  it("takes the slippage off, rounding down", () => {
    expect(minOut(1_000_000n, 100)).toBe(990_000n);
    expect(minOut(999n, 50)).toBe(994n);
  });
  it("measures the loss in dollars, never negative", () => {
    expect(priceImpactPct(100, 99)).toBeCloseTo(1);
    expect(priceImpactPct(100, 101)).toBe(0);
    expect(priceImpactPct(0, 1)).toBeNull();
  });
});
