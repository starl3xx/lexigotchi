import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, WORD_USD_PRICE, WORD_PER_USD, priceWord } from "@/lib/params";
import { runSim, DEFAULT_SIM_CONFIG, type SimConfig } from "@/lib/sim/simulate";
import { marketSim, flowsFromDays, DEFAULT_MARKET, WORD_SUPPLY } from "@/lib/sim/market";

describe("USD-pegged pricing", () => {
  it("prices are a sane USD ladder", () => {
    const p = DEFAULT_PARAMS.prices;
    for (const v of Object.values(p)) expect(v).toBeGreaterThan(0);
    expect(p.pack).toBeGreaterThan(p.claim); // a pack of 5 costs more than one claim
    expect(p.claim).toBeGreaterThan(p.roll);
    expect(p.dailyMint).toBeLessThan(p.pack); // the daily habit is cheap
    expect(p.snack).toBeLessThan(0.1); // care is trivially cheap
  });

  it("priceWord converts USD targets to $WORD at the live peg", () => {
    expect(priceWord(1)).toBeCloseTo(WORD_PER_USD, 6);
    expect(priceWord(DEFAULT_PARAMS.prices.pack)).toBeCloseTo(DEFAULT_PARAMS.prices.pack / WORD_USD_PRICE, 0);
    // a $0.60 pack is a few million $WORD at a sub-microcent token
    expect(priceWord(0.6)).toBeGreaterThan(1e6);
  });

  it("does NOT seed the chance-based jackpot from treasury (compliance), seeds the yield pool", () => {
    expect(DEFAULT_PARAMS.seed.jackpot).toBe(0);
    expect(DEFAULT_PARAMS.seed.pool).toBeGreaterThan(0);
  });
});

describe("constant-product market layer", () => {
  const cfg: SimConfig = { ...DEFAULT_SIM_CONFIG, days: 120, population: 400 };
  const res = runSim(cfg);
  const flows = flowsFromDays(res.days);

  it("flowsFromDays diffs the cumulative series correctly", () => {
    const synthetic = [
      { externalInflowTotal: 10, distributionToday: 1, jackpotPaidToday: 0, burnedTotal: 4 },
      { externalInflowTotal: 25, distributionToday: 2, jackpotPaidToday: 3, burnedTotal: 9 },
    ];
    const f = flowsFromDays(synthetic);
    expect(f[0].externalInflowToday).toBe(10);
    expect(f[1].externalInflowToday).toBe(15); // 25 - 10
    expect(f[1].earningsToday).toBe(5); // 2 + 3
    expect(f[1].burnToday).toBe(5); // 9 - 4
  });

  it("net buy demand pumps the price (and the sim was net-positive)", () => {
    const m = marketSim(flows, DEFAULT_MARKET);
    expect(m.peakMult).toBeGreaterThan(1);
    expect(m.startPrice).toBeCloseTo(DEFAULT_MARKET.initPriceUsd, 12);
  });

  it("adding LP depth flattens the pump", () => {
    const shallow = marketSim(flows, { ...DEFAULT_MARKET, lpSeedUsd: 0 });
    const deep = marketSim(flows, { ...DEFAULT_MARKET, lpSeedUsd: 10000 });
    expect(deep.peakMult).toBeLessThan(shallow.peakMult);
  });

  it("burns a positive, sub-total fraction of supply (priced as it climbs)", () => {
    const m = marketSim(flows, DEFAULT_MARKET);
    expect(m.tokensBurned).toBeGreaterThan(0);
    expect(m.tokensBurned).toBeLessThan(WORD_SUPPLY);
    expect(m.tokensBurnedPctSupply).toBeGreaterThan(0);
    expect(m.tokensBurnedPctSupply).toBeLessThan(1);
  });

  it("is deterministic for the same flows + params", () => {
    const a = marketSim(flows, DEFAULT_MARKET);
    const b = marketSim(flows, DEFAULT_MARKET);
    expect(a.peakPrice).toBe(b.peakPrice);
    expect(a.finalPrice).toBe(b.finalPrice);
  });
});
