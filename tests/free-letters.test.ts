/**
 * The free-letter rules (lib/freeLetters.ts; decisions.md #21): the budget's env override, the
 * dictionary stop at 95%, the budget stop, the 10-daily limit, and how an expired voucher is
 * settled against the chain. The routes' wiring is pinned in tests/free-letter-routes.test.ts.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@/lib/params";
import { crossKeys, dailiesLeft, finishedProfiles, freeLetterBudget, freeStop, profileDailyDays, usedOnchain, FREE_LETTERS, type Grant } from "@/lib/freeLetters";

const DICT = 4584;

describe("params", () => {
  it("holds the decided numbers: 10 dailies, a 30,000 budget, a stop at 95%", () => {
    expect(DEFAULT_PARAMS.freeLetters).toEqual({ freeDailyLimit: 10, budget: 30_000, freeStopClaimedFraction: 0.95 });
    expect(FREE_LETTERS).toEqual({ daily: 1, pack: 5 });
  });
});

describe("freeLetterBudget", () => {
  it("reads FREE_LETTER_BUDGET, else params", () => {
    expect(freeLetterBudget({ FREE_LETTER_BUDGET: "30000" })).toBe(30_000);
    expect(freeLetterBudget({ FREE_LETTER_BUDGET: " 12 " })).toBe(12);
    expect(freeLetterBudget({ FREE_LETTER_BUDGET: "0" })).toBe(0); // switches free letters off
    expect(freeLetterBudget({})).toBe(30_000);
  });

  it("ignores a value that isn't a whole number, rather than giving away an unlimited or broken budget", () => {
    for (const bad of ["", "lots", "-5", "1.5", "NaN"]) expect(freeLetterBudget({ FREE_LETTER_BUDGET: bad })).toBe(30_000);
  });
});

describe("freeStop", () => {
  const base = { claimed: 0, dictionary: DICT, signed: 0, budget: 30_000, letters: 1 };

  it("stops at about 95% of the dictionary claimed", () => {
    expect(freeStop({ ...base, claimed: 4354 })).toBeNull(); // 94.98%
    expect(freeStop({ ...base, claimed: 4355 })).toBe("dictionary"); // 95.00%
    expect(freeStop({ ...base, claimed: 4355, letters: 0 })).toBe("dictionary"); // even a re-issue
  });

  it("stops a grant that would pass the budget, counting a pack as 5", () => {
    expect(freeStop({ ...base, signed: 29_999, letters: 1 })).toBeNull();
    expect(freeStop({ ...base, signed: 30_000, letters: 1 })).toBe("budget");
    expect(freeStop({ ...base, signed: 29_996, letters: 5 })).toBe("budget");
    expect(freeStop({ ...base, signed: 29_995, letters: 5 })).toBeNull();
  });

  it("never budget-stops a voucher the ledger already counts (letters 0)", () => {
    expect(freeStop({ ...base, signed: 30_000, letters: 0 })).toBeNull();
  });

  it("skips a rule it couldn't read, instead of stopping everyone", () => {
    expect(freeStop({ ...base, claimed: null, signed: 30_000 })).toBe("budget");
    expect(freeStop({ ...base, claimed: 4400, signed: null })).toBe("dictionary");
    expect(freeStop({ ...base, claimed: null, signed: null })).toBeNull();
  });
});

describe("dailiesLeft", () => {
  it("counts down from 10, never below 0, and is unknown when the ledger can't be read", () => {
    expect(dailiesLeft(0)).toBe(10);
    expect(dailiesLeft(9)).toBe(1);
    expect(dailiesLeft(10)).toBe(0);
    expect(dailiesLeft(12)).toBe(0);
    expect(dailiesLeft(null)).toBeNull();
  });
});

describe("usedOnchain", () => {
  it("a pack voucher was used if its key's freePackClaimed is set", () => {
    expect(usedOnchain("pack", 0, true)).toBe(true);
    expect(usedOnchain("pack", 0, false)).toBe(false);
  });

  it("a daily voucher for day D was used if its key's dailyUsed reached D + 1", () => {
    const D = 20_400;
    expect(usedOnchain("daily", D, D + 1)).toBe(true);
    expect(usedOnchain("daily", D, 0)).toBe(false); // never used: the letter goes back
    expect(usedOnchain("daily", D, D)).toBe(false); // the day before
    expect(usedOnchain("daily", D, BigInt(D + 3))).toBe(true); // a later day: counted, the safe side
  });
});

describe("across ledger accounts (Bugbot on #199)", () => {
  const T = 20_400;
  const g = (o: Partial<Grant>): Grant => ({ account: "fid:7", kind: "daily", period: T - 1, key: 7n, used: true, wallet: "0xw", ...o });

  it("a profile's days are its own plus past, kept days its wallets were paid on other ledgers", () => {
    expect(profileDailyDays([T - 3, T - 2], [g({ period: T - 1 }), g({ period: T - 2 })], T)).toBe(3); // a shared day counts once
    expect(profileDailyDays([], [g({ period: T - 1, used: false })], T)).toBe(0); // given back
    expect(profileDailyDays([], [g({ period: T, used: null })], T)).toBe(0); // today's: never a stranger's block
    expect(profileDailyDays([], [g({ kind: "pack", period: 0 })], T)).toBe(0);
  });

  it("today's cross grants join the onchain check by key", () => {
    const cross = [g({ period: T, key: 1n }), g({ period: T - 1, key: 2n }), g({ kind: "pack", period: 0, key: 3n })];
    expect(crossKeys(cross, "daily", T)).toEqual([1n]);
    expect(crossKeys(cross, "pack", 0)).toEqual([3n]);
  });

  it("finished profiles carry every account, key, and wallet they used, so each reminder channel can match", () => {
    const accountOf = (w: string) => (w === "0xs" ? "0xp" : w);
    const grants: Grant[] = [
      ...Array.from({ length: 6 }, (_, i) => g({ account: "0xp", key: 100n, period: T - 1 - i, wallet: "0xp" })),
      ...Array.from({ length: 4 }, (_, i) => g({ account: "fid:7", key: 7n, period: T - 7 - i, wallet: "0xs" })),
      g({ account: "0xq", key: 200n, period: T - 1, wallet: "0xq" }),
    ];
    const f = finishedProfiles(grants, accountOf, 10);
    expect([...f.accounts].sort()).toEqual(["0xp", "fid:7"]);
    expect([...f.keys].sort()).toEqual(["100", "7"]);
    expect([...f.wallets].sort()).toEqual(["0xp", "0xs"]);
    expect(finishedProfiles(grants, accountOf, 11).accounts.size).toBe(0);
  });
});
