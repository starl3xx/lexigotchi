import { describe, it, expect } from "vitest";
import { msUntilUtcMidnight, formatCountdown } from "@/components/game/primitives";

/**
 * The daily letter and the jackpot both reset on uint32(block.timestamp / 1 days) — UTC days since
 * epoch. This counted to LOCAL midnight, so every player outside UTC saw the wrong number: in UTC-5
 * it claimed the daily unlocked five hours after it actually had; in UTC+9 it invited a claim the
 * contract would reject.
 */
describe("countdown targets UTC midnight, not local", () => {
  it("is 24h at exactly UTC midnight", () => {
    expect(msUntilUtcMidnight(new Date("2026-08-12T00:00:00Z"))).toBe(24 * 3.6e6);
  });

  it("is 1h at 23:00 UTC", () => {
    expect(msUntilUtcMidnight(new Date("2026-08-12T23:00:00Z"))).toBe(3.6e6);
  });

  it("is 1s at 23:59:59 UTC", () => {
    expect(msUntilUtcMidnight(new Date("2026-08-12T23:59:59Z"))).toBe(1000);
  });

  // The actual bug: the answer must not depend on where the player is.
  it("gives the same answer for the same instant regardless of local offset", () => {
    const instant = new Date("2026-08-12T18:30:00Z");
    const expected = msUntilUtcMidnight(instant);
    // Same absolute moment, expressed in three offsets.
    for (const iso of ["2026-08-12T13:30:00-05:00", "2026-08-13T03:30:00+09:00", "2026-08-12T18:30:00Z"]) {
      expect(msUntilUtcMidnight(new Date(iso))).toBe(expected);
    }
  });

  it("crosses month and year boundaries", () => {
    expect(msUntilUtcMidnight(new Date("2026-08-31T23:00:00Z"))).toBe(3.6e6);
    expect(msUntilUtcMidnight(new Date("2026-12-31T23:00:00Z"))).toBe(3.6e6);
  });

  it("never returns a negative window", () => {
    expect(msUntilUtcMidnight(new Date("2026-08-12T23:59:59.999Z"))).toBeGreaterThan(0);
  });
});

describe("formatCountdown", () => {
  it("pads minutes and seconds", () => {
    expect(formatCountdown(3.6e6 + 5 * 6e4 + 7000)).toBe("1h 05m 07s");
  });

  it("clamps a passed deadline to zero rather than showing negatives", () => {
    expect(formatCountdown(-5000)).toBe("0h 00m 00s");
  });
});
