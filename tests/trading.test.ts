import { describe, it, expect } from "vitest";
import { runSim, DEFAULT_SIM_CONFIG, type SimConfig } from "@/lib/sim/simulate";
import { DEFAULT_PARAMS, type Params } from "@/lib/params";

function params(trading: boolean, dissolution: boolean): Params {
  return {
    ...DEFAULT_PARAMS,
    trading: { ...DEFAULT_PARAMS.trading, enabled: trading },
    dissolution: { ...DEFAULT_PARAMS.dissolution, enabled: dissolution },
  };
}
const cfg = (trading: boolean, dissolution: boolean): SimConfig => ({
  ...DEFAULT_SIM_CONFIG,
  days: 120,
  population: 400,
  params: params(trading, dissolution),
});

describe("secondary-market levers (sim)", () => {
  it("are OFF by default — baseline parity (no trades, no dissolutions)", () => {
    const r = runSim(cfg(false, false));
    expect(r.final.lettersTradedTotal).toBe(0);
    expect(r.final.dissolutionsTotal).toBe(0);
    // with no dissolution, gross claims === words currently held (nothing freed)
    expect(r.final.claimsEverTotal).toBe(r.final.totalClaims);
  });

  it("bookkeeping identity holds: held === gross claims − dissolutions", () => {
    for (const [t, d] of [[true, false], [false, true], [true, true]] as const) {
      const r = runSim(cfg(t, d));
      expect(r.final.totalClaims).toBe(r.final.claimsEverTotal - r.final.dissolutionsTotal);
    }
  });

  it("is deterministic for the same (config, seed)", () => {
    const a = runSim(cfg(true, true));
    const b = runSim(cfg(true, true));
    expect(a.final.pool).toBe(b.final.pool);
    expect(a.final.claimsEverTotal).toBe(b.final.claimsEverTotal);
    expect(a.final.lettersTradedTotal).toBe(b.final.lettersTradedTotal);
    expect(a.final.dissolutionsTotal).toBe(b.final.dissolutionsTotal);
  });

  it("stays solvent with both levers on (P2P trading only leaks the royalty)", () => {
    const r = runSim(cfg(true, true)); // runSim asserts solvency every day; also check final buckets
    expect(r.final.pool).toBeGreaterThanOrEqual(-1e-9);
    expect(r.final.jackpot).toBeGreaterThanOrEqual(-1e-9);
    expect(r.final.burnedTotal).toBeGreaterThanOrEqual(0);
    expect(r.final.treasuryTotal).toBeGreaterThanOrEqual(0);
  });

  it("trading clears letters and gives casuals clean recoup (isolated from yield/jackpot noise)", () => {
    const base = runSim(cfg(false, false));
    const trade = runSim(cfg(true, false));
    expect(trade.final.lettersTradedTotal).toBeGreaterThan(0);
    const baseCasual = base.playerRoi.find((p) => p.archetype === "casual")!;
    const tradeCasual = trade.playerRoi.find((p) => p.archetype === "casual")!;
    expect(baseCasual.recoup).toBe(0); // no market, no recoup
    expect(tradeCasual.recoup).toBeGreaterThan(0); // surplus letters now recoup $WORD
    // ...but the recoup is small relative to spend (the headline finding: modest, not a windfall)
    expect(tradeCasual.recoup / tradeCasual.spent).toBeLessThan(0.1);
  });

  it("dissolution recycles dead claims (gross claims exceed words held)", () => {
    const r = runSim(cfg(false, true));
    expect(r.final.dissolutionsTotal).toBeGreaterThan(0);
    expect(r.final.claimsEverTotal).toBeGreaterThan(r.final.totalClaims); // names freed + re-claimed
  });

  it("dissolution never recycles the day's answer — no jackpot win-suppression (Bugbot #3)", () => {
    // The bug: runDissolution ran before jackpot resolution and could dissolve the day's answer
    // word, voiding a legitimate jackpot and inflating rollovers. A correct dissolution frees
    // names (more claiming → MORE answer-days claimed), so its rollover rate must NOT exceed
    // baseline. Drop the `word === answer` guard and this assertion fails.
    const rollover = (r: ReturnType<typeof runSim>) =>
      r.days.filter((d) => d.jackpotRolledOver).length / r.days.length;
    const base = rollover(runSim(cfg(false, false)));
    const diss = rollover(runSim(cfg(false, true)));
    expect(diss).toBeLessThanOrEqual(base + 0.02); // dissolution must not inflate rollovers
  });
});
