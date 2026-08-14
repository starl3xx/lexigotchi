import { describe, it, expect } from "vitest";
import {
  hungerTargets,
  dailyTargets,
  fidLookupFrom,
  jackpotWinnerFid,
  HUNGER_WARN_HOURS,
  type DailyState,
} from "@/lib/notify/triggers";
import type { KeeperWord } from "@/lib/keeper/shares";
import { DEFAULT_PARAMS } from "@/lib/params";

// Targeting bugs are the invisible kind: a notification the player needed and never got, or one
// that went to the wrong person. Neither surfaces in production, so the rules get pinned here.

const A = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const HOUR = 3600;
const DAY = 86_400;
const HUNGRY_AT = DEFAULT_PARAMS.care.hungryAfterDays * DAY;

const w = (over: Partial<KeeperWord> = {}): KeeperWord => {
  const base = {
    tokenId: 1n,
    word: "ABOUT",
    owner: A.toLowerCase() as `0x${string}`,
    staked: true,
    daysUnfed: 0,
    prestigeLevel: 0,
    upperAll: true,
    ...over,
  };
  return { ...base, secondsUnfed: over.secondsUnfed ?? base.daysUnfed * DAY };
};

const lookup = fidLookupFrom([
  { fid: 100, linkedWallets: [A.toLowerCase()] },
  { fid: 200, linkedWallets: [B, C] },
]);

describe("fidLookupFrom", () => {
  it("resolves any linked wallet of a player to the same FID", () => {
    expect(lookup(B)).toBe(200);
    expect(lookup(C)).toBe(200);
  });

  it("is case-insensitive in both directions — chain reads and Neynar disagree on casing", () => {
    expect(lookup(A)).toBe(100);
    expect(lookup(A.toLowerCase())).toBe(100);
    expect(lookup(A.toUpperCase())).toBe(100);
  });

  it("returns undefined for a wallet nobody has linked", () => {
    expect(lookup("0x1111111111111111111111111111111111111111")).toBeUndefined();
  });
});

describe("hungerTargets", () => {
  it("warns while there is still time to act", () => {
    const t = hungerTargets([w({ secondsUnfed: HUNGRY_AT - 6 * HOUR })], lookup);
    expect(t).toEqual([{ fid: 100, words: 1, hoursLeft: 6 }]);
  });

  // Already-hungry words would re-qualify every single day. That's how a useful warning becomes
  // the reason someone mutes the app.
  it("says NOTHING about a word that is already hungry", () => {
    expect(hungerTargets([w({ secondsUnfed: HUNGRY_AT })], lookup)).toEqual([]);
    expect(hungerTargets([w({ secondsUnfed: HUNGRY_AT + 10 * DAY })], lookup)).toEqual([]);
  });

  it("stays quiet until the deadline is actually near", () => {
    expect(hungerTargets([w({ secondsUnfed: HUNGRY_AT - 48 * HOUR })], lookup)).toEqual([]);
  });

  // The window must be WIDER than the keeper's cadence. At exactly 24h with a once-daily keeper,
  // a pass landing a minute late leaves a word that was just outside the window on Monday already
  // hungry on Tuesday — and already-hungry words are skipped, so it is never warned at all. The
  // feature would fail silently for exactly the words it exists to protect.
  it("warns wider than the daily keeper period, so consecutive passes overlap", () => {
    expect(HUNGER_WARN_HOURS).toBeGreaterThan(24);
  });

  it("still catches a word that a late keeper pass would otherwise skip past", () => {
    // Monday's pass: 25h out — outside a 24h window, inside ours.
    const mondayOut = hungerTargets([w({ secondsUnfed: HUNGRY_AT - 25 * HOUR })], lookup, 24);
    expect(mondayOut).toEqual([]); // what the old window did
    const mondayIn = hungerTargets([w({ secondsUnfed: HUNGRY_AT - 25 * HOUR })], lookup);
    expect(mondayIn).toHaveLength(1); // warned in time
    // Tuesday, 24h+ later: already hungry, so a 24h window would never have warned it at all.
    expect(hungerTargets([w({ secondsUnfed: HUNGRY_AT + HOUR })], lookup)).toEqual([]);
  });

  it("ignores unstaked words — their hunger costs the owner nothing", () => {
    expect(hungerTargets([w({ staked: false, secondsUnfed: HUNGRY_AT - HOUR })], lookup)).toEqual([]);
  });

  it("reports the SOONEST deadline, since that's the clock the player has to beat", () => {
    const t = hungerTargets(
      [
        w({ tokenId: 1n, secondsUnfed: HUNGRY_AT - 20 * HOUR }),
        w({ tokenId: 2n, secondsUnfed: HUNGRY_AT - 3 * HOUR }),
        w({ tokenId: 3n, secondsUnfed: HUNGRY_AT - 11 * HOUR }),
      ],
      lookup,
    );
    expect(t).toEqual([{ fid: 100, words: 3, hoursLeft: 3 }]);
  });

  it("groups a player's words across all their linked wallets into one warning", () => {
    const t = hungerTargets(
      [
        w({ tokenId: 1n, owner: B as `0x${string}`, secondsUnfed: HUNGRY_AT - 5 * HOUR }),
        w({ tokenId: 2n, owner: C as `0x${string}`, secondsUnfed: HUNGRY_AT - 9 * HOUR }),
      ],
      lookup,
    );
    expect(t).toEqual([{ fid: 200, words: 2, hoursLeft: 5 }]);
  });

  it("drops owners who aren't notifiable players rather than guessing", () => {
    const stranger = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    expect(hungerTargets([w({ owner: stranger, secondsUnfed: HUNGRY_AT - HOUR })], lookup)).toEqual([]);
  });

  // Rounding UP would promise time the player doesn't have; a bare floor can read "in 0h", which
  // sounds like it already happened.
  it("never rounds the deadline up, and never reports 0h", () => {
    const t = hungerTargets([w({ secondsUnfed: HUNGRY_AT - (5 * HOUR + 3500) })], lookup);
    expect(t[0].hoursLeft).toBe(5);
    const imminent = hungerTargets([w({ secondsUnfed: HUNGRY_AT - 60 })], lookup);
    expect(imminent[0].hoursLeft).toBe(1);
  });

  it("is order-stable so a pass is reproducible", () => {
    const words = [
      w({ tokenId: 1n, owner: B as `0x${string}`, secondsUnfed: HUNGRY_AT - HOUR }),
      w({ tokenId: 2n, secondsUnfed: HUNGRY_AT - HOUR }),
    ];
    expect(hungerTargets(words, lookup).map((t) => t.fid)).toEqual([100, 200]);
    expect(hungerTargets([...words].reverse(), lookup).map((t) => t.fid)).toEqual([100, 200]);
  });
});

describe("dailyTargets", () => {
  const day = 1000;
  const st = (fid: number, lastDay: number | null): DailyState => ({
    fid,
    lastDailyDayPlusOne: lastDay === null ? 0 : lastDay + 1,
  });

  it("reminds a recent player who hasn't pulled today", () => {
    expect(dailyTargets([st(1, day - 1)], day)).toEqual([1]);
  });

  it("says nothing to someone who already pulled today", () => {
    expect(dailyTargets([st(1, day)], day)).toEqual([]);
  });

  // A daily ping to someone who last played two months ago is how an app gets muted.
  it("leaves drifted-away players alone", () => {
    expect(dailyTargets([st(1, day - 8)], day)).toEqual([]);
    expect(dailyTargets([st(1, day - 60)], day)).toEqual([]);
  });

  it("keeps players right at the edge of the activity window", () => {
    expect(dailyTargets([st(1, day - 7)], day)).toEqual([1]);
  });

  // "Your daily RESET" is a lie to someone who has never used one.
  it("skips players who added the app but never pulled", () => {
    expect(dailyTargets([st(1, null)], day)).toEqual([]);
  });

  it("returns an explicit list, never an empty one meaning 'everybody'", () => {
    const targets = dailyTargets([st(1, day), st(2, day)], day);
    expect(targets).toEqual([]); // caller must treat this as "nobody", and sendNotification does
  });

  it("is sorted, so a retried run sends the identical request", () => {
    expect(dailyTargets([st(9, day - 1), st(3, day - 2), st(7, day - 1)], day)).toEqual([3, 7, 9]);
  });
});

describe("jackpotWinnerFid", () => {
  it("resolves a winning address to its player", () => {
    expect(jackpotWinnerFid(B, lookup)).toBe(200);
  });

  it("is undefined when the winner isn't reachable, rather than notifying someone else", () => {
    expect(jackpotWinnerFid("0x9999999999999999999999999999999999999999", lookup)).toBeUndefined();
    expect(jackpotWinnerFid(undefined, lookup)).toBeUndefined();
  });
});
