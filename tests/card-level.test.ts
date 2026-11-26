/**
 * A word's ascension stage for its pictures (lib/onchain/cardLevel, decisions.md #48): read from
 * the chain, kept a few minutes, and read again when an address names another stage, so a word
 * shared the moment after it ascends is never drawn with the stage before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const chain = vi.hoisted(() => ({ deployed: true, level: 0, reads: 0, fail: false }));
vi.mock("@/lib/onchain/addresses", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/addresses")>()),
  isSuiteDeployed: () => chain.deployed,
  addressOf: () => "0x0000000000000000000000000000000000000001",
}));
vi.mock("@/lib/onchain/reads", () => ({
  getPublicClient: () => ({
    readContract: async () => {
      chain.reads += 1;
      if (chain.fail) throw new Error("rpc down");
      return BigInt(chain.level);
    },
  }),
}));

const { cardLevelOf, cardLevelSoon, resetCardLevels, RECHECK_MS } = await import("@/lib/onchain/cardLevel");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
  chain.deployed = true;
  chain.level = 0;
  chain.reads = 0;
  chain.fail = false;
  resetCardLevels();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a word's stage, for its pictures", () => {
  it("is the chain's, kept for five minutes, by the word whatever its casing", async () => {
    chain.level = 3;
    expect(await cardLevelOf("VIVID")).toBe(3);
    expect(await cardLevelOf("vivid")).toBe(3);
    expect(chain.reads).toBe(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    chain.level = 4;
    expect(await cardLevelOf("VIVID")).toBe(4);
    expect(chain.reads).toBe(2);
  });

  it("is read again when the address names another stage: a word shared the moment after it ascends", async () => {
    chain.level = 3;
    expect(await cardLevelOf("VIVID", 3)).toBe(3);
    // it ascends; its link and pictures now name stage 4, and the kept 3 is a few seconds old
    chain.level = 4;
    vi.advanceTimersByTime(RECHECK_MS);
    expect(await cardLevelOf("VIVID", 4)).toBe(4);
    expect(chain.reads).toBe(2);
    // an address that names the kept stage reads nothing
    expect(await cardLevelOf("VIVID", 4)).toBe(4);
    expect(chain.reads).toBe(2);
  });

  it("an address with no stage disputes a kept stage too (it says: not ascended)", async () => {
    chain.level = 2;
    await cardLevelOf("VIVID", 2);
    vi.advanceTimersByTime(RECHECK_MS);
    await cardLevelOf("VIVID", null);
    expect(chain.reads).toBe(2);
    // a caller with no address to go by (nothing passed) takes what is kept
    vi.advanceTimersByTime(RECHECK_MS);
    await cardLevelOf("VIVID");
    expect(chain.reads).toBe(2);
  });

  it("never draws the hint, and a made-up address can't turn every request into a chain read", async () => {
    chain.level = 1;
    expect(await cardLevelOf("VIVID", 5)).toBe(1);
    for (let i = 0; i < 20; i++) expect(await cardLevelOf("VIVID", 5)).toBe(1);
    expect(chain.reads).toBe(1); // the kept one is brand new
    vi.advanceTimersByTime(RECHECK_MS);
    for (let i = 0; i < 20; i++) expect(await cardLevelOf("VIVID", 5)).toBe(1);
    expect(chain.reads).toBe(2); // one more, then kept again
  });

  it("is null when the game isn't deployed or the read fails, and never throws", async () => {
    chain.deployed = false;
    expect(await cardLevelOf("VIVID")).toBeNull();
    expect(chain.reads).toBe(0);
    chain.deployed = true;
    chain.fail = true;
    expect(await cardLevelOf("VIVID")).toBeNull();
    expect(await cardLevelSoon("VIVID", 4)).toBeNull();
  });

  it("callers that arrive together share one read", async () => {
    chain.level = 2;
    const all = await Promise.all([cardLevelOf("VIVID"), cardLevelOf("VIVID", 2), cardLevelOf("vivid", 5)]);
    expect(all).toEqual([2, 2, 2]);
    expect(chain.reads).toBe(1);
  });
});
