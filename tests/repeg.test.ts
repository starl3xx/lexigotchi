/**
 * The price keeper's planner (src/lib/keeper/repeg.ts): every guard that stands between a price
 * feed and a change to what players pay.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_POLICY, planRepeg, targetWei, type LivePrice, type PricePoint } from "@/lib/keeper/repeg";

const WEI = 10n ** 18n;
const live = (priceUsd: number, over: Partial<LivePrice> = {}): LivePrice => ({
  priceUsd,
  reserveUsd: 20_000,
  source: "geckoterminal",
  ...over,
});
// $1 pack at $2.5e-7 per $WORD = 4,000,000 $WORD
const PEG = 2.5e-7;
const pack = (currentTokens: bigint): PricePoint => ({ item: "pack", currentWei: currentTokens * WEI, targetUsd: 1 });

describe("planRepeg guards", () => {
  it("never moves money on the oracle's fallback constant", () => {
    expect(planRepeg(live(PEG, { source: "fallback" }), [pack(1_000_000n)], 2000)).toEqual({ ok: false, reason: "fallback_price" });
  });

  it("refuses a thin pool, or one whose depth is unknown", () => {
    expect(planRepeg(live(PEG, { reserveUsd: 4_999 }), [pack(1_000_000n)], 2000)).toEqual({ ok: false, reason: "thin_liquidity" });
    expect(planRepeg(live(PEG, { reserveUsd: null }), [pack(1_000_000n)], 2000)).toEqual({ ok: false, reason: "thin_liquidity" });
  });

  it("refuses a nonsense price", () => {
    expect(planRepeg(live(0), [pack(1n)], 2000)).toEqual({ ok: false, reason: "bad_price" });
    expect(planRepeg(live(Number.NaN), [pack(1n)], 2000)).toEqual({ ok: false, reason: "bad_price" });
  });

  it("leaves a price within 5% alone", () => {
    expect(planRepeg(live(PEG), [pack(3_850_000n)], 2000)).toEqual({ ok: true, moves: [] }); // 3.9% off
  });

  it("never touches a zero price: the free daily stays free", () => {
    const daily: PricePoint = { item: "daily", currentWei: 0n, targetUsd: 0 };
    expect(planRepeg(live(PEG), [daily], 2000)).toEqual({ ok: true, moves: [] });
  });

  it("does nothing when repeg is disabled onchain (maxMoveBps 0)", () => {
    expect(planRepeg(live(PEG), [pack(1_000_000n)], 0)).toEqual({ ok: true, moves: [] });
  });
});

describe("planRepeg moves", () => {
  it("moves straight to the target when it is inside the band", () => {
    const plan = planRepeg(live(PEG), [pack(3_500_000n)], 2000); // target 4.0M, +14.3%
    expect(plan).toEqual({ ok: true, moves: [{ item: "pack", fromWei: 3_500_000n * WEI, toWei: 4_000_000n * WEI, clamped: false }] });
  });

  it("clamps a big gap one bps inside the onchain band, both directions", () => {
    const up = planRepeg(live(PEG), [pack(1_000_000n)], 2000);
    const down = planRepeg(live(PEG), [pack(10_000_000n)], 2000);
    if (!up.ok || !down.ok) throw new Error("expected plans");
    expect(up.moves[0]).toMatchObject({ toWei: 1_199_900n * WEI, clamped: true }); // +19.99%
    expect(down.moves[0]).toMatchObject({ toWei: 8_001_000n * WEI, clamped: true }); // −19.99%
  });

  it("would pass the contract's own clamp check (delta × 10000 ≤ current × maxMoveBps)", () => {
    for (const current of [1n, 7n, 999_999n, 1_234_567n, 10_000_000n]) {
      const plan = planRepeg(live(PEG), [pack(current)], 2000);
      if (!plan.ok) throw new Error("expected a plan");
      for (const m of plan.moves) {
        const delta = m.toWei > m.fromWei ? m.toWei - m.fromWei : m.fromWei - m.toWei;
        expect(delta * 10_000n <= m.fromWei * 2000n).toBe(true);
        expect(m.toWei > 0n).toBe(true);
      }
    }
  });

  it("the tighter of the onchain band and the 25% policy cap wins", () => {
    const plan = planRepeg(live(PEG), [pack(1_000_000n)], 10_000); // onchain allows 100%
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.moves[0].toWei).toBe(1_249_900n * WEI); // capped at the 25% policy
    expect(DEFAULT_POLICY.policyCapBps).toBe(2_500);
  });
});

describe("targetWei", () => {
  it("is whole tokens of the USD target at the live price", () => {
    expect(targetWei(1, PEG)).toBe(4_000_000n * WEI);
    expect(targetWei(0.25, PEG)).toBe(1_000_000n * WEI);
  });
});
