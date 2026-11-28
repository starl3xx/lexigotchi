/**
 * Today's three pots (src/components/game/todayPots.ts): each pot's $WORD amount and about what
 * that is in dollars, and the player's place in today's jackpot. What must hold: dollars only
 * where the game shows dollars at all (never for test $WORD), an unread pot is a dash and never
 * "0", and every line about getting into the jackpot says "staked and fed".
 */
import { describe, it, expect } from "vitest";
import { POOL_DAILY_SHARE, jackpotStanding, potLine } from "@/components/game/todayPots";
import { fmtUsdShort } from "@/lib/wordAmount";
import { DEFAULT_PARAMS } from "@/lib/params";

describe("potLine", () => {
  const live = { usd: true, wordUsd: 0.000_000_2 };

  it("shows the $WORD amount and about what it is in dollars", () => {
    expect(potLine(18_500_000, live)).toEqual({ amount: "18.50M", unit: "$WORD", usd: "about $3.70" });
    expect(potLine(9_400_000_000, live)).toEqual({ amount: "9.40B", unit: "$WORD", usd: "about $1.9K" });
  });

  it("shows no dollars for test $WORD, which has no value", () => {
    expect(potLine(18_500_000, { usd: false, wordUsd: 0.000_000_23 })).toEqual({ amount: "18.50M", unit: "test $WORD", usd: null });
  });

  it("shows a dash for a pot not read yet, and no dollar figure for it", () => {
    expect(potLine(null, live)).toEqual({ amount: "–", unit: "$WORD", usd: null });
    expect(potLine(Number.NaN, live).amount).toBe("–");
    expect(potLine(null, { usd: false, wordUsd: 1 })).toEqual({ amount: "–", unit: "test $WORD", usd: null });
  });

  it("shows an empty pot as 0, which is a real answer", () => {
    expect(potLine(0, live)).toEqual({ amount: "0", unit: "$WORD", usd: "about $0.00" });
  });

  it("shows no dollar figure without a price", () => {
    expect(potLine(18_500_000, { usd: true, wordUsd: 0 }).usd).toBeNull();
  });
});

describe("fmtUsdShort", () => {
  it("reads at a glance at every size", () => {
    expect(fmtUsdShort(4.2)).toBe("$4.20");
    expect(fmtUsdShort(420.4)).toBe("$420");
    expect(fmtUsdShort(1_234)).toBe("$1.2K");
    expect(fmtUsdShort(3_400_000)).toBe("$3.4M");
  });

  it("is a dash when unknown, never $0", () => {
    expect(fmtUsdShort(null)).toBe("–");
    expect(fmtUsdShort(undefined)).toBe("–");
    expect(fmtUsdShort(Number.NaN)).toBe("–");
  });
});

describe("POOL_DAILY_SHARE", () => {
  it("is the keeper's own daily rate, never typed", () => {
    expect(POOL_DAILY_SHARE).toBe(`${DEFAULT_PARAMS.staking.dailyDistributionRate * 100}%`);
  });
});

describe("jackpotStanding", () => {
  const base = { revealedWord: null, holds: null, wordsKnown: true, words: 3, inTheRunning: 1 } as const;

  it("names today's word once it has been drawn, before anything else", () => {
    expect(jackpotStanding({ ...base, revealedWord: "CRANE", holds: "in" })).toMatchObject({ text: "Today’s word was", word: "CRANE" });
  });

  it("tells a player who holds today's word, in the running or not", () => {
    expect(jackpotStanding({ ...base, holds: "in" })).toMatchObject({ secret: true, tone: "candy" });
    expect(jackpotStanding({ ...base, holds: "out" })?.text).toMatch(/Stake it and wake it/);
  });

  it("says nothing while the player's words load: a returning player never reads the newcomer's line", () => {
    expect(jackpotStanding({ ...base, wordsKnown: false, words: 0, inTheRunning: 0 })).toBeNull();
  });

  it("tells a player with nothing in the running how to get in, staked and fed", () => {
    expect(jackpotStanding({ ...base, words: 0, inTheRunning: 0 })?.text).toBe("Spell a word, stake it, and wake it every day to enter");
    expect(jackpotStanding({ ...base, inTheRunning: 0 })?.text).toBe("Stake a word and wake it every day to enter");
  });

  it("tells a player in the running so", () => {
    expect(jackpotStanding(base)).toEqual({ text: "You’re in the running", tone: "gold" });
  });
});
