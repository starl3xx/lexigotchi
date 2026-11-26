/**
 * The shared world (lib/worldSnapshot): one scan a minute for everyone, and, for a caller that
 * can't wait for a scan (a word's back picture), a kept world rather than none (decisions.md #48,
 * part 5; Bugbot on #255).
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const chain = vi.hoisted(() => ({ scans: 0, release: [] as (() => void)[], fail: false, hold: false }));
vi.mock("@/lib/world", () => ({
  scanWorld: () => {
    const n = ++chain.scans;
    const snap = { words: [{ word: "GLYPH", owner: "0xabc", number: n, raised: 5 }], letters: {}, wins: {}, yieldWeight: 10, weights: { GLYPH: 2 } };
    if (chain.fail) return Promise.reject(new Error("rpc down"));
    if (!chain.hold) return Promise.resolve(snap);
    return new Promise((resolve) => chain.release.push(() => resolve(snap)));
  },
  readYieldPot: async () => 100,
  scanDrawn: async () => ({}),
  buildLeaderboards: () => ({}),
}));
vi.mock("@/lib/db/walletLinks", () => ({ loadLinkMap: async () => ({ accountOf: (a: string) => a }) }));
vi.mock("@/lib/profile/faces", () => ({ playerFaces: async () => ({ profiles: {} }) }));

import { STALE_OK_MS, resetWorld, worldNow, worldSoon } from "@/lib/worldSnapshot";

/** Which scan a world came from: the stand-in numbers GLYPH's card by the scan. */
const scanOf = (w: Awaited<ReturnType<typeof worldSoon>>) => w?.body.numbers?.GLYPH ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  chain.scans = 0;
  chain.release = [];
  chain.fail = false;
  chain.hold = false;
  resetWorld();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the world for a caller that can't wait", () => {
  it("gives a kept world at once while a new scan runs, and the new one to whoever asks next", async () => {
    expect(scanOf(await worldNow())).toBe(1);
    // over a minute old: worldNow would wait for a new scan
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    chain.hold = true;
    const got = await worldSoon(4000);
    expect(scanOf(got)).toBe(1); // the kept one, with no wait
    expect(chain.scans).toBe(2); // and a new scan was started
    // asked again while that scan runs: still the kept one, and no third scan
    expect(scanOf(await worldSoon(4000))).toBe(1);
    expect(chain.scans).toBe(2);
    chain.release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanOf(await worldSoon(4000))).toBe(2);
    expect(chain.scans).toBe(2);
  });

  it("starts no scan for a world under a minute old", async () => {
    await worldNow();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scanOf(await worldSoon(4000))).toBe(1);
    expect(chain.scans).toBe(1);
  });

  it("with nothing kept, waits for the scan only so long, then gives null; the scan carries on", async () => {
    chain.hold = true;
    const asked = worldSoon(4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await asked).toBeNull();
    expect(chain.scans).toBe(1);
    chain.release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    // the next request finds what that scan read, with no new scan
    expect(scanOf(await worldSoon(4000))).toBe(1);
    expect(chain.scans).toBe(1);
  });

  it("with nothing kept and a quick scan, gives the scan's world", async () => {
    expect(scanOf(await worldSoon(4000))).toBe(1);
  });

  it("does not show a world older than a quarter of an hour without trying for a new one first", async () => {
    await worldNow();
    await vi.advanceTimersByTimeAsync(STALE_OK_MS + 1000);
    chain.hold = true;
    const asked = worldSoon(4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await asked).toBeNull();
    chain.release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanOf(await worldSoon(4000))).toBe(2);
  });

  it("never throws: a failed scan is null with nothing kept, and the kept world otherwise", async () => {
    chain.fail = true;
    expect(await worldSoon(4000)).toBeNull();
    chain.fail = false;
    const kept = scanOf(await worldNow()); // the second scan: the first one failed
    expect(kept).toBe(2);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    chain.fail = true;
    expect(scanOf(await worldSoon(4000))).toBe(kept);
    // and so does worldNow, as before: the last good world when a scan fails
    expect(scanOf(await worldNow())).toBe(kept);
  });
});
