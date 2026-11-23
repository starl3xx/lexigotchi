/**
 * The $WORD page's numbers (src/lib/wordStats.ts): the two kinds of burn, and the pool pick.
 */
import { describe, it, expect } from "vitest";
import { parseTopPool, summarizeSupply, WORD_MINTED } from "@/lib/wordStats";

const wei = (n: number) => BigInt(Math.round(n)) * 10n ** 18n;

describe("summarizeSupply", () => {
  it("counts destroyed (minted − supply) and the dead address separately, and sums them", () => {
    const s = summarizeSupply(wei(99_824_884_970), wei(110_000_000));
    expect(s.minted).toBe(WORD_MINTED);
    expect(s.destroyed).toBeCloseTo(175_115_030, 0);
    expect(s.dead).toBe(110_000_000);
    expect(s.outOfCirculation).toBeCloseTo(285_115_030, 0);
  });
});

describe("parseTopPool", () => {
  it("takes the deepest pool, both sides of it, with its 24h figures", () => {
    const pool = parseTopPool({
      data: [
        { attributes: { address: "0xsmall", reserve_in_usd: "17", volume_usd: { h24: "0" } }, relationships: { dex: { data: { id: "uniswap-v4-base" } } } },
        {
          attributes: { address: "0xbig", reserve_in_usd: "17923.07", volume_usd: { h24: "12.5" }, price_change_percentage: { h24: "-1.2" } },
          relationships: { dex: { data: { id: "uniswap-v4-base" } } },
        },
      ],
    })!;
    expect(pool.liquidityUsd).toBeCloseTo(17923.07);
    expect(pool.volume24hUsd).toBe(12.5);
    expect(pool.priceChange24hPct).toBe(-1.2);
    expect(pool.url).toBe("https://www.geckoterminal.com/base/pools/0xbig");
  });
  it("is null for a response without pools", () => {
    expect(parseTopPool({})).toBeNull();
    expect(parseTopPool({ data: [] })).toBeNull();
  });
});
