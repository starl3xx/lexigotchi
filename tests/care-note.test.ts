/**
 * The word sheet's care line (src/components/game/careNote.ts): what staking does for THIS word and
 * why Feed is off. A tester read "Stake to earn" on a 1/5-raised word, and "fed" on a word nobody
 * had fed.
 */
import { describe, it, expect } from "vitest";
import { careNote } from "@/components/game/careNote";

const NOW = 1_800_000_000;
const lower = [false, true, false, false, false];
const upper = [true, true, true, true, true];
const base = { snackShort: null, nowSec: NOW };

describe("careNote", () => {
  it("unstaked, not fully raised: the jackpot, not $WORD, and why Feed is off", () => {
    const { note, feedOff } = careNote({ upper: lower, staked: false, daysUnfed: 0 }, "fed", base);
    expect(note).toMatch(/daily jackpot/);
    expect(note).toMatch(/earns \$WORD only once all 5 letters are UPPERCASE \(1\/5 now\)/);
    expect(note).not.toMatch(/earns \$WORD every day/);
    expect(feedOff).toMatch(/Stake it first/);
  });

  it("unstaked, fully UPPERCASE: staking earns $WORD every day", () => {
    expect(careNote({ upper, staked: false, daysUnfed: 0 }, "fed", base).note).toMatch(/earns \$WORD every day/);
  });

  it("staked and full: says nothing needs feeding yet, and when that changes", () => {
    const { note, feedOff } = careNote({ upper: lower, staked: true, daysUnfed: 0, lastFedAt: NOW - 3_600 }, "fed", base);
    expect(note).toMatch(/^Full: in the daily jackpot\./);
    expect(note).toMatch(/No feeding needed until it gets peckish in about 23 hours/);
    expect(note).not.toMatch(/\bfed\b/i); // nobody fed it; it started full
    expect(feedOff).toBe("Not hungry yet");
  });

  it("staked and full with under an hour left: minutes", () => {
    const { note } = careNote({ upper, staked: true, daysUnfed: 0, lastFedAt: NOW - 86_400 + 600 }, "fed", base);
    expect(note).toMatch(/in about 10 minutes/);
    expect(note).toMatch(/earning \$WORD every day/);
  });

  it("peckish: Feed is on; an UPPERCASE word says it earns half", () => {
    const up = careNote({ upper, staked: true, daysUnfed: 1 }, "peckish", base);
    expect(up.feedOff).toBeNull();
    expect(up.note).toMatch(/earning half until you feed it/);
    expect(careNote({ upper: lower, staked: true, daysUnfed: 1 }, "peckish", base).note).toMatch(/still in the jackpot/);
  });

  it("hungry: out of the jackpot; earning nothing only matters for an UPPERCASE word", () => {
    expect(careNote({ upper, staked: true, daysUnfed: 3 }, "hungry", base).note).toMatch(/out of the jackpot and earning nothing/);
    expect(careNote({ upper: lower, staked: true, daysUnfed: 3 }, "hungry", base).note).not.toMatch(/earning nothing/);
  });

  it("can't afford a snack: Feed is off, and the line says why", () => {
    const short = " A snack costs 84K $WORD, and you don’t have enough.";
    const { note, feedOff } = careNote({ upper, staked: true, daysUnfed: 2 }, "peckish", { ...base, snackShort: short });
    expect(feedOff).toBe("Not enough $WORD for a snack");
    expect(note.endsWith(short)).toBe(true);
  });

  it("no em dashes in player copy", () => {
    for (const h of ["fed", "peckish", "hungry"] as const) {
      for (const staked of [true, false]) {
        expect(careNote({ upper: lower, staked, daysUnfed: 1, lastFedAt: NOW }, h, base).note).not.toMatch(/—/);
      }
    }
  });
});
