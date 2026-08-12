import { describe, it, expect, beforeAll } from "vitest";

// Set before importing: the signer reads these at call time, and the draw secret is required.
beforeAll(() => {
  process.env.SIGNER_DRAW_SECRET = "test-secret-not-a-real-one";
});

const load = async () => await import("@/lib/onchain/signer");

/** Full supply for every letter — the unconstrained case. */
const FULL = Array.from({ length: 26 }, () => 1000);

describe("drawLetters is idempotent by construction", () => {
  // This is the property that makes the reveal endpoint safe: the reveal is permissionless and the
  // signer picks the outcome, so a sampler that rolled fresh per call would let a player re-request
  // until they liked their pack.
  it("returns identical letters for the same commitId, every time", async () => {
    const { drawLetters } = await load();
    const first = drawLetters(42n, 5, FULL);
    for (let i = 0; i < 20; i++) expect(drawLetters(42n, 5, FULL)).toEqual(first);
  });

  it("gives different commits different draws", async () => {
    const { drawLetters } = await load();
    const draws = new Set(Array.from({ length: 25 }, (_, i) => drawLetters(BigInt(i), 5, FULL).join(",")));
    // Not a distribution claim — just that the commitId actually feeds the derivation.
    expect(draws.size).toBeGreaterThan(15);
  });

  it("honours the requested count", async () => {
    const { drawLetters } = await load();
    expect(drawLetters(7n, 1, FULL)).toHaveLength(1);
    expect(drawLetters(7n, 5, FULL)).toHaveLength(5);
  });

  it("only ever draws valid letter indexes", async () => {
    const { drawLetters } = await load();
    for (let c = 0; c < 50; c++) {
      for (const idx of drawLetters(BigInt(c), 5, FULL)) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(25);
      }
    }
  });
});

describe("drawLetters respects supply caps", () => {
  // Letters.reveal reverts CapExceeded on a capped letter, stranding a paid commit.
  it("never draws a letter with zero remaining supply", async () => {
    const { drawLetters } = await load();
    // Only 'e' (4) and 'a' (0) have supply left.
    const scarce = Array.from({ length: 26 }, (_, i) => (i === 4 || i === 0 ? 500 : 0));
    for (let c = 0; c < 40; c++) {
      for (const idx of drawLetters(BigInt(c), 5, scarce)) expect([0, 4]).toContain(idx);
    }
  });

  it("does not over-draw a letter that is nearly exhausted", async () => {
    const { drawLetters } = await load();
    // One 'e' left, one 'a' left, nothing else — a 2-letter draw must use each at most once.
    const nearly = Array.from({ length: 26 }, (_, i) => (i === 4 || i === 0 ? 1 : 0));
    const drawn = drawLetters(3n, 2, nearly);
    expect(new Set(drawn).size).toBe(2);
  });

  it("throws rather than drawing an invalid letter when nothing is available", async () => {
    const { drawLetters } = await load();
    expect(() => drawLetters(1n, 1, Array.from({ length: 26 }, () => 0))).toThrow(/uncapped/i);
  });
});

describe("drawSuccess", () => {
  it("is deterministic per commit", async () => {
    const { drawSuccess } = await load();
    const first = drawSuccess("roll", 99n, 0.45);
    for (let i = 0; i < 20; i++) expect(drawSuccess("roll", 99n, 0.45)).toBe(first);
  });

  it("respects the probability bounds exactly", async () => {
    const { drawSuccess } = await load();
    for (let c = 0; c < 30; c++) {
      expect(drawSuccess("roll", BigInt(c), 0)).toBe(false);
      expect(drawSuccess("roll", BigInt(c), 1)).toBe(true);
    }
  });

  it("separates roll and prestige namespaces for the same commitId", async () => {
    const { drawSuccess } = await load();
    // Same id, same p — the namespaces must not be perfectly correlated.
    const rolls = Array.from({ length: 40 }, (_, i) => drawSuccess("roll", BigInt(i), 0.5));
    const prestige = Array.from({ length: 40 }, (_, i) => drawSuccess("prestige", BigInt(i), 0.5));
    expect(rolls).not.toEqual(prestige);
  });

  it("tracks the pity curve in aggregate (45% base vs 85% cap)", async () => {
    const { drawSuccess } = await load();
    const rate = (p: number) =>
      Array.from({ length: 400 }, (_, i) => drawSuccess("roll", BigInt(i), p)).filter(Boolean).length / 400;
    expect(rate(0.45)).toBeGreaterThan(0.35);
    expect(rate(0.45)).toBeLessThan(0.55);
    expect(rate(0.85)).toBeGreaterThan(rate(0.45));
  });
});
