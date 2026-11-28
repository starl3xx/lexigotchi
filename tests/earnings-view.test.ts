/**
 * The earnings as the screens show them (src/components/game/earnings.ts): the server summary
 * mapped to words, "today"/"yesterday" in the player's calendar, each word's status and line, the
 * earnings line under the stage, and practice mode's own payouts.
 */
import { describe, it, expect } from "vitest";
import {
  PRACTICE_SHARE,
  addPracticeDay,
  earningLine,
  earningStatus,
  earningsFromJson,
  earningsRowTarget,
  earningsLineText,
  payoutWhen,
  practiceEarnings,
  practicePayout,
  type PlayerEarnings,
} from "@/components/game/earnings";
import { stageLine } from "@/components/game/stagePick";
import { TIER_WEIGHT } from "@/lib/economy";
import type { OwnedWord } from "@/components/game/state";

const E18 = 10n ** 18n;
const ALL = [true, true, true, true, true];
const word = (w: string, o: Partial<OwnedWord> = {}): OwnedWord => ({
  word: w,
  tier: "Common",
  upper: ALL,
  staked: true,
  daysUnfed: 0,
  prestigeLevel: 0,
  prestigePity: 0,
  mine: true,
  ...o,
});

describe("earningsFromJson", () => {
  it("turns wei into whole $WORD, token ids into the player's words, and the day into a time", () => {
    const e = earningsFromJson(
      {
        latestDay: 20782,
        words: [
          { tokenId: "11", total: String(150_000n * E18), waiting: "0", latest: String(40_000n * E18), days: 4 },
          { tokenId: "99", total: String(5n * E18), waiting: "0", latest: "0", days: 1 }, // no longer held
        ],
        yieldTotal: String(150_005n * E18),
        yieldLatest: String(40_000n * E18),
        bountyTotal: String(7n * E18),
        total: String(150_012n * E18),
        waiting: String(7n * E18),
        latest: String(40_007n * E18), // the day's yield and a bounty week that settled that morning
      },
      (id) => (id === "11" ? "VIVID" : undefined),
    );
    expect(e.byWord).toEqual({ VIVID: { total: 150_000, latest: 40_000, waiting: 0 } });
    expect([e.total, e.latest, e.waiting, e.bounty]).toEqual([150_012, 40_007, 7, 7]);
    expect(new Date(e.latestAt!).toISOString()).toBe("2026-11-25T00:05:00.000Z");
  });

  it("with no payout day, there is no payout time", () => {
    const e = earningsFromJson({ latestDay: null, words: [], yieldTotal: "0", yieldLatest: "0", bountyTotal: "0", total: "0", waiting: "0", latest: "0" }, () => undefined);
    expect(e.latestAt).toBeNull();
  });
});

describe("payoutWhen", () => {
  it("speaks in the player's own calendar", () => {
    const now = new Date(2026, 10, 25, 9, 0).getTime();
    expect(payoutWhen(new Date(2026, 10, 25, 0, 30).getTime(), now)).toBe("today");
    expect(payoutWhen(new Date(2026, 10, 24, 18, 5).getTime(), now)).toBe("yesterday");
    expect(payoutWhen(new Date(2026, 10, 22, 18, 5).getTime(), now)).toBe("on Sun, Nov 22");
  });
});

describe("earningStatus and earningLine", () => {
  it("names the one thing between a word and a full share", () => {
    expect(earningStatus(word("VIVID"), "fed")).toEqual({ kind: "earning" });
    expect(earningStatus(word("VIVID"), "peckish")).toEqual({ kind: "half" });
    expect(earningStatus(word("VIVID"), "hungry")).toEqual({ kind: "paused" });
    expect(earningStatus(word("VIVID", { staked: false }), "fed")).toEqual({ kind: "unstaked" });
    expect(earningStatus(word("CRANE", { upper: [true, true, true, false, false] }), "fed")).toEqual({ kind: "raise", left: 2, staked: true });
    expect(earningLine("CRANE", { kind: "raise", left: 1, staked: false })).toBe("Raise 1 more letter to UPPERCASE and stake CRANE to earn $WORD every day.");
    // already staked: never asked to stake it again (Bugbot on #177)
    expect(earningLine("CRANE", { kind: "raise", left: 2, staked: true })).toBe("Raise 2 more letters to UPPERCASE, and CRANE earns $WORD every day.");
    expect(earningLine("VIVID", { kind: "paused" })).toBe("VIVID is asleep, so it earns nothing until you wake it.");
  });
});

describe("earningsRowTarget (the word sheet's earnings row)", () => {
  // Odds rise with pity, as the game's do: 40% base, 15 points a miss.
  const rollProb = (p: number) => Math.min(0.85, 0.4 + 0.15 * p);
  const NO_PITY = Array.from({ length: 26 }, () => 0);
  const pityOn = (letter: string, misses: number) => NO_PITY.map((p, i) => (i === letter.charCodeAt(0) - 65 ? misses : p));
  const target = (w: OwnedWord, o: { earned?: number; pity?: number[]; h?: "fed" | "hungry" } = {}) =>
    earningsRowTarget(w, { earned: o.earned ?? 0, status: earningStatus(w, o.h ?? "fed"), pity: o.pity ?? NO_PITY, rollProb });
  const AFFIX = (o: Partial<OwnedWord> = {}) => word("AFFIX", { upper: [false, false, false, false, false], ...o });

  it("a row with letters left to raise opens the roll for the first, staked or not", () => {
    expect(target(AFFIX())).toEqual({ kind: "roll", pos: 0 });
    expect(target(AFFIX({ staked: false }))).toEqual({ kind: "roll", pos: 0 });
    expect(target(AFFIX({ upper: [true, true, false, false, false] }))).toEqual({ kind: "roll", pos: 2 });
  });

  it("names the letter Next steps would: the best odds, so a letter with misses behind it", () => {
    expect(target(AFFIX(), { pity: pityOn("I", 2) })).toEqual({ kind: "roll", pos: 3 });
    // a raised letter is never picked, whatever its pity
    expect(target(AFFIX({ upper: [false, false, false, true, false] }), { pity: pityOn("I", 2) })).toEqual({ kind: "roll", pos: 0 });
  });

  it("a caretaker's row takes the first lowercase letter: the staker's pity isn't this wallet's", () => {
    expect(target(AFFIX({ mine: false, care: true }), { pity: pityOn("X", 3) })).toEqual({ kind: "roll", pos: 0 });
  });

  it("every other row opens Your earnings", () => {
    // a linked wallet's word: this wallet can't roll it
    expect(target(AFFIX({ mine: false }))).toEqual({ kind: "earnings" });
    // a word that has earned shows what it earned, whatever its letters
    expect(target(AFFIX(), { earned: 100 })).toEqual({ kind: "earnings" });
    // fully raised: earning, hungry, or waiting to be staked (a row tap never sends anything)
    expect(target(word("VIVID"))).toEqual({ kind: "earnings" });
    expect(target(word("VIVID"), { h: "hungry" })).toEqual({ kind: "earnings" });
    expect(target(word("VIVID", { staked: false }))).toEqual({ kind: "earnings" });
  });
});

describe("earningsLineText (under the Today stage)", () => {
  const fmt = (n: number) => `${n / 1000}K`;
  const base = { canEarn: true, practice: false, payoutTime: "6:05 PM", fmt };
  const e = (o: Partial<PlayerEarnings>): PlayerEarnings => ({ latestAt: null, byWord: {}, total: 0, latest: 0, waiting: 0, bounty: 0, ...o });

  it("says what the latest payout brought and the total", () => {
    const now = Date.now();
    const t = earningsLineText(e({ latestAt: now, total: 1_400_000, latest: 120_000 }), { ...base, now });
    expect(t).toEqual({ lead: "Your words earned ", amount: "+120K", rest: " $WORD today · 1400K in all" });
  });

  it("says plainly when the latest payout brought nothing", () => {
    const now = Date.now();
    expect(earningsLineText(e({ latestAt: now, total: 50_000 }), { ...base, now })?.lead).toBe("Nothing earned today");
  });

  it("before the first payout, says when it comes, and is silent when no word can earn", () => {
    expect(earningsLineText(e({}), base)?.lead).toBe("Your words get their first earnings at 6:05 PM.");
    expect(earningsLineText(e({}), { ...base, practice: true })?.lead).toBe("Your words get their first earnings when you skip to the next day.");
    expect(earningsLineText(e({}), { ...base, canEarn: false })).toBeNull();
  });
});

describe("practice payouts", () => {
  it("pays all-UPPERCASE staked words by tier and hunger, as the keeper weighs them", () => {
    const paid = practicePayout([
      word("TEASE", { tier: "Rare" }),
      word("VIVID", { daysUnfed: 1 }), // peckish: half
      word("FIZZY", { daysUnfed: 3 }), // hungry: nothing
      word("MOTEL", { staked: false }),
      word("CRANE", { upper: [true, false, true, true, true] }),
      word("PIXEL", { mine: false }), // a linked wallet's word: paid there, not here
    ]);
    expect(paid).toEqual({ TEASE: PRACTICE_SHARE * TIER_WEIGHT.Rare, VIVID: PRACTICE_SHARE / 2 });
  });

  it("adds each day to the record; the latest is that day's, and nothing ever waits", () => {
    const one = addPracticeDay(undefined, 1000, { TEASE: 100, VIVID: 50 });
    const two = addPracticeDay(one, 2000, { TEASE: 100 });
    expect(two).toEqual({ at: 2000, byWord: { TEASE: { total: 200, latest: 100 }, VIVID: { total: 50, latest: 0 } } });
    const e = practiceEarnings(two);
    expect([e.latestAt, e.total, e.latest, e.waiting]).toEqual([2000, 250, 100, 0]);
    expect(practiceEarnings(undefined).latestAt).toBeNull();
  });
});

describe("stageLine with earnings", () => {
  it("a full all-UPPERCASE star says what it earned at the latest payout", () => {
    expect(stageLine({ word: word("VIVID"), mood: "full" }, { amount: "40.2K", when: "today" })).toBe(
      "VIVID is awake, in the jackpot, and earned 40.2K $WORD today.",
    );
    expect(stageLine({ word: word("VIVID"), mood: "full" })).toBe("VIVID is awake, in the jackpot, and earning $WORD.");
    // a mixed-case word doesn't earn, whatever is passed
    expect(stageLine({ word: word("TEASE", { upper: [false, false, false, false, false] }), mood: "full" }, { amount: "1K", when: "today" })).toBe(
      "TEASE is awake and in the daily jackpot.",
    );
  });
});
