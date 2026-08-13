import { describe, it, expect } from "vitest";
import { parseWordPrice, fallbackWordPrice } from "@/lib/oracle/wordPrice";
import { WORD_USD_PRICE, currentWordUsd, setLiveWordUsd, priceWord } from "@/lib/params";
import { usdToWord, usdToWordWei } from "@/lib/admin/format";

/** The real GeckoTerminal token-endpoint shape, captured 2026-08-12. */
const REAL_PAYLOAD = {
  data: {
    id: "base_0x304e649e69979298bd1aee63e175adf07885fb4b",
    type: "token",
    attributes: {
      address: "0x304e649e69979298bd1aee63e175adf07885fb4b",
      symbol: "WORD",
      decimals: 18,
      price_usd: "0.0000002557796828",
      fdv_usd: "25522.9462293064",
      total_reserve_in_usd: "17077.7117948523878800393862630675088",
      volume_usd: { h24: "0.0" },
      market_cap_usd: null,
    },
  },
};

describe("parseWordPrice", () => {
  it("parses the real GeckoTerminal shape (prices arrive as strings)", () => {
    const p = parseWordPrice(REAL_PAYLOAD, 1_755_000_000_000);
    expect(p).not.toBeNull();
    expect(p!.priceUsd).toBeCloseTo(2.557796828e-7, 15);
    expect(p!.wordPerUsd).toBeCloseTo(1 / 2.557796828e-7, 0);
    expect(p!.fdvUsd).toBeCloseTo(25522.95, 1);
    expect(p!.source).toBe("geckoterminal");
    expect(p!.fetchedAt).toBe(1_755_000_000_000);
    // 24h volume of "0.0" fails the positive-finite gate — null, not 0, which the UI renders as
    // "unknown" rather than pretending a measured zero.
    expect(p!.volume24hUsd).toBeNull();
  });

  it.each([
    ["missing body", {}],
    ["missing attributes", { data: {} }],
    ["missing price", { data: { attributes: { fdv_usd: "1" } } }],
    ["NaN price", { data: { attributes: { price_usd: "not-a-number" } } }],
    ["zero price", { data: { attributes: { price_usd: "0" } } }],
    ["negative price", { data: { attributes: { price_usd: "-1" } } }],
    ["object price", { data: { attributes: { price_usd: {} } } }],
  ])("returns null on %s — a bad peg mis-sizes every conversion", (_label, payload) => {
    expect(parseWordPrice(payload, 0)).toBeNull();
  });
});

describe("fallbackWordPrice", () => {
  it("answers with the params constant and says so", () => {
    const f = fallbackWordPrice();
    expect(f.priceUsd).toBe(WORD_USD_PRICE);
    expect(f.source).toBe("fallback");
    expect(f.fetchedAt).toBeNull();
  });
});

/**
 * The live peg cell is the mechanism that upgrades every conversion without touching call sites:
 * defaults read it AT CALL TIME. These pin that — a refactor to import-time defaults would pass
 * every other test and silently freeze the peg at the June snapshot.
 */
describe("the live peg cell", () => {
  it("starts on the fallback constant", () => {
    expect(currentWordUsd()).toBe(WORD_USD_PRICE);
  });

  it("call-time defaults follow the cell — priceWord, usdToWord, usdToWordWei", () => {
    const before = usdToWord(1);
    setLiveWordUsd(WORD_USD_PRICE * 2); // price doubles → $1 buys half the $WORD
    expect(usdToWord(1)).toBeCloseTo(before / 2, 6);
    expect(priceWord(1)).toBeCloseTo(before / 2, 6);
    expect(BigInt(usdToWordWei(1))).toBe(BigInt(Math.round(before / 2)) * 10n ** 18n);
  });

  it("an explicit peg argument still wins over the cell", () => {
    setLiveWordUsd(WORD_USD_PRICE * 3);
    expect(usdToWord(1, WORD_USD_PRICE)).toBeCloseTo(1 / WORD_USD_PRICE, 6);
  });

  it("ignores garbage — NaN, zero, negative, Infinity never become the peg", () => {
    setLiveWordUsd(WORD_USD_PRICE); // known state
    for (const bad of [NaN, 0, -1, Infinity, -Infinity]) setLiveWordUsd(bad);
    expect(currentWordUsd()).toBe(WORD_USD_PRICE);
  });
});
