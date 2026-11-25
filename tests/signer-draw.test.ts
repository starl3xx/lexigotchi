import { describe, it, expect, beforeAll } from "vitest";

// Set before importing: the signer reads these at call time, and the draw secret is required.
beforeAll(() => {
  process.env.SIGNER_DRAW_SECRET = "test-secret-not-a-real-one";
});

const load = async () => await import("@/lib/onchain/signer");

/** Full supply for every letter — the unconstrained case. */
const FULL = Array.from({ length: 26 }, () => 1000);

/** The contracts a draw is issued for (any well-formed addresses: only their identity matters). */
const LETTERS = "0x00000000000000000000000000000000000000a1" as const;
const ROLLS = "0x00000000000000000000000000000000000000b2" as const;
const PRESTIGE = "0x00000000000000000000000000000000000000c3" as const;
/** A redeployed Prestige: same chain, same secret, commit ids restarted at 0. */
const PRESTIGE_REDEPLOYED = "0x00000000000000000000000000000000000000d4" as const;

describe("drawLetters is idempotent by construction", () => {
  // This is the property that makes the reveal endpoint safe: the reveal is permissionless and the
  // signer picks the outcome, so a sampler that rolled fresh per call would let a player re-request
  // until they liked their pack.
  it("returns identical letters for the same commitId, every time", async () => {
    const { drawLetters } = await load();
    const first = drawLetters(LETTERS, 42n, 5, FULL);
    for (let i = 0; i < 20; i++) expect(drawLetters(LETTERS, 42n, 5, FULL)).toEqual(first);
  });

  it("gives different commits different draws", async () => {
    const { drawLetters } = await load();
    const draws = new Set(Array.from({ length: 25 }, (_, i) => drawLetters(LETTERS, BigInt(i), 5, FULL).join(",")));
    // Not a distribution claim — just that the commitId actually feeds the derivation.
    expect(draws.size).toBeGreaterThan(15);
  });

  it("honours the requested count", async () => {
    const { drawLetters } = await load();
    expect(drawLetters(LETTERS, 7n, 1, FULL)).toHaveLength(1);
    expect(drawLetters(LETTERS, 7n, 5, FULL)).toHaveLength(5);
  });

  it("only ever draws valid letter indexes", async () => {
    const { drawLetters } = await load();
    for (let c = 0; c < 50; c++) {
      for (const idx of drawLetters(LETTERS, BigInt(c), 5, FULL)) {
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
      for (const idx of drawLetters(LETTERS, BigInt(c), 5, scarce)) expect([0, 4]).toContain(idx);
    }
  });

  it("does not over-draw a letter that is nearly exhausted", async () => {
    const { drawLetters } = await load();
    // One 'e' left, one 'a' left, nothing else — a 2-letter draw must use each at most once.
    const nearly = Array.from({ length: 26 }, (_, i) => (i === 4 || i === 0 ? 1 : 0));
    const drawn = drawLetters(LETTERS, 3n, 2, nearly);
    expect(new Set(drawn).size).toBe(2);
  });

  it("throws rather than drawing an invalid letter when nothing is available", async () => {
    const { drawLetters } = await load();
    expect(() => drawLetters(LETTERS, 1n, 1, Array.from({ length: 26 }, () => 0))).toThrow(/uncapped/i);
  });
});

describe("drawSuccess", () => {
  it("is deterministic per commit", async () => {
    const { drawSuccess } = await load();
    const first = drawSuccess("roll", ROLLS, 99n, 0.4);
    for (let i = 0; i < 20; i++) expect(drawSuccess("roll", ROLLS, 99n, 0.4)).toBe(first);
  });

  it("respects the probability bounds exactly", async () => {
    const { drawSuccess } = await load();
    for (let c = 0; c < 30; c++) {
      expect(drawSuccess("roll", ROLLS, BigInt(c), 0)).toBe(false);
      expect(drawSuccess("roll", ROLLS, BigInt(c), 1)).toBe(true);
    }
  });

  it("separates roll and prestige namespaces for the same commitId", async () => {
    const { drawSuccess } = await load();
    // Same id, same p — the namespaces must not be perfectly correlated.
    const rolls = Array.from({ length: 40 }, (_, i) => drawSuccess("roll", ROLLS, BigInt(i), 0.5));
    const prestige = Array.from({ length: 40 }, (_, i) => drawSuccess("prestige", PRESTIGE, BigInt(i), 0.5));
    expect(rolls).not.toEqual(prestige);
  });

  it("tracks the pity curve in aggregate (40% base vs 85% cap)", async () => {
    const { drawSuccess } = await load();
    const rate = (p: number) =>
      Array.from({ length: 400 }, (_, i) => drawSuccess("roll", ROLLS, BigInt(i), p)).filter(Boolean).length / 400;
    expect(rate(0.4)).toBeGreaterThan(0.3);
    expect(rate(0.4)).toBeLessThan(0.5);
    expect(rate(0.85)).toBeGreaterThan(rate(0.4));
  });
});

/**
 * The daily's (identity, day) seed — the property that makes the single-prompt daily safe. The
 * reveal is pre-signed BEFORE the commit mines, so the API response shows the letter early; only
 * a draw that cannot change on re-request makes that preview worthless to a shopper.
 */
describe("dailySeed and the day-keyed daily draw", () => {
  it("is deterministic per (identity, day) — asking twice is the same letter", async () => {
    const { drawLetters, dailySeed } = await load();
    const key = (1n << 160n) | 0x58a5n;
    const first = drawLetters(LETTERS, dailySeed(key, 20678), 1, FULL, "daily");
    for (let i = 0; i < 10; i++) expect(drawLetters(LETTERS, dailySeed(key, 20678), 1, FULL, "daily")).toEqual(first);
  });

  it("distinct identities and distinct days get their own seeds", async () => {
    const { dailySeed } = await load();
    const seeds = new Set<bigint>();
    for (const key of [1n, 2n, (1n << 160n) | 7n, (1n << 160n) | 8n]) {
      for (const day of [20678, 20679, 20680]) seeds.add(dailySeed(key, day));
    }
    expect(seeds.size).toBe(12);
  });

  it("day feeds the draw — one identity does not get the same letter forever", async () => {
    const { drawLetters, dailySeed } = await load();
    const key = 6500n;
    const letters = new Set(
      Array.from({ length: 60 }, (_, d) => drawLetters(LETTERS, dailySeed(key, 20678 + d), 1, FULL, "daily")[0]),
    );
    // 60 days of one identity's dailies span multiple letters — the day is genuinely in the seed.
    expect(letters.size).toBeGreaterThan(3);
  });

  it("the daily namespace is separated from the commitId-keyed letters draws", async () => {
    const { drawLetters } = await load();
    // The same numeric seed through the two namespaces diverges somewhere across 40 trials —
    // deterministic HMACs, so this is a fixed fact, not a flaky sample.
    const diverges = Array.from({ length: 40 }, (_, i) => {
      const s = BigInt(i) + (1n << 40n);
      return drawLetters(LETTERS, s, 1, FULL, "daily")[0] !== drawLetters(LETTERS, s, 1, FULL, "letters")[0];
    });
    expect(diverges.some(Boolean)).toBe(true);
  });

  it("keeps synthetic verified-wallet keys exact through the shift", async () => {
    const { dailySeed } = await load();
    const key = (1n << 160n) | BigInt("0x58a585909cccd4f84ebc3868db6da8d9882fee9c");
    const seed = dailySeed(key, 20678);
    expect(seed >> 32n).toBe(key); // reversible — nothing truncated
    expect(seed & 0xffffffffn).toBe(20678n);
  });
});

/**
 * The Prestige audit's finding (2026-11-25, AUDIT.md): commit ids restart at 0 on a redeploy, and the
 * retired contract's outcomes are public in its events. A draw keyed by commitId alone would repeat
 * them on the new contract, and a contract caller can choose which id it gets.
 */
describe("every draw is bound to the contract it is issued for", () => {
  it("a redeployed contract's restarted ids do not repeat the old contract's outcomes", async () => {
    const { drawSuccess } = await load();
    const old = Array.from({ length: 40 }, (_, i) => drawSuccess("prestige", PRESTIGE, BigInt(i), 0.5));
    const fresh = Array.from({ length: 40 }, (_, i) => drawSuccess("prestige", PRESTIGE_REDEPLOYED, BigInt(i), 0.5));
    expect(fresh).not.toEqual(old);
  });

  it("a redeployed Letters draws different packs for the same commit ids", async () => {
    const { drawLetters } = await load();
    const other = "0x00000000000000000000000000000000000000e5" as const;
    const differs = Array.from({ length: 20 }, (_, i) =>
      drawLetters(LETTERS, BigInt(i), 5, FULL).join(",") !== drawLetters(other, BigInt(i), 5, FULL).join(","),
    );
    expect(differs.some(Boolean)).toBe(true);
  });

  it("the address's letter case does not fork a draw", async () => {
    const { drawSuccess } = await load();
    const mixed = "0xAbCdEf0000000000000000000000000000000001" as const;
    const lower = mixed.toLowerCase() as `0x${string}`;
    for (let i = 0; i < 20; i++) {
      expect(drawSuccess("roll", mixed, BigInt(i), 0.5)).toBe(drawSuccess("roll", lower, BigInt(i), 0.5));
    }
  });

  it("refuses to draw without a well-formed contract address", async () => {
    const { drawSuccess, drawLetters } = await load();
    expect(() => drawSuccess("roll", "" as `0x${string}`, 1n, 0.5)).toThrow(/address/);
    expect(() => drawLetters("0x1234" as `0x${string}`, 1n, 5, FULL)).toThrow(/address/);
  });
});
