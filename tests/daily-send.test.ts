/**
 * What became of a daily letter's send (src/lib/onchain/dailySend.ts, decisions.md #49 part 3).
 * The daily's commit and reveal ride one send with a PREDICTED commit id, and the wallet's "sent"
 * can't say which of them landed. The envelope's marks follow this plan, so the rules it must keep:
 * - a number is given only for a commit the chain says is this wallet's one-letter commit;
 * - the server is never asked to open a commit while the wallet's own reveal may still land;
 * - the envelope leaves only when the chain says the daily was never used, never from time alone.
 */
import { describe, it, expect } from "vitest";
import { DAILY_HOLD_MS, DAILY_LOOK_MS, dailyPlan, type DailyLook } from "@/lib/onchain/dailySend";

const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const look = (over: Partial<DailyLook> = {}): DailyLook => ({ me: ME, bundled: true, sent: true, predicted: 200n, slot: null, fresh: null, used: null, waited: 2_000, unrevealedFor: 0, ...over });
const mine = (revealed: boolean) => ({ buyer: ME, count: 1, revealed });

describe("both landed", () => {
  it("the predicted slot is this wallet's daily, revealed: ask for the chain's letters", () => {
    expect(dailyPlan(look({ slot: mine(true), used: true }))).toEqual({ do: "open", commitId: 200n, revealed: true });
  });

  it("the wallet's address is compared whatever its letter case", () => {
    expect(dailyPlan(look({ slot: { ...mine(true), buyer: ME.toLowerCase() } }))).toEqual({ do: "open", commitId: 200n, revealed: true });
  });
});

describe("the commit landed and the reveal hasn't yet", () => {
  it("holds while the wallet's own reveal may still land: two reveals for one commit means one reverts", () => {
    expect(dailyPlan(look({ slot: mine(false), unrevealedFor: 0 }))).toEqual({ do: "hold", commitId: 200n });
    expect(dailyPlan(look({ slot: mine(false), unrevealedFor: DAILY_HOLD_MS - 1 }))).toEqual({ do: "hold", commitId: 200n });
  });

  it("asks the server once the wallet's reveal has been waited for long enough", () => {
    expect(dailyPlan(look({ slot: mine(false), unrevealedFor: DAILY_HOLD_MS }))).toEqual({ do: "open", commitId: 200n, revealed: false });
  });

  it("asks the server at once when the wallet refused the reveal (the second of two prompts)", () => {
    expect(dailyPlan(look({ sent: false, used: true, slot: mine(false) }))).toEqual({ do: "open", commitId: 200n, revealed: false });
  });

  it("asks the server at once when the send carried no reveal", () => {
    expect(dailyPlan(look({ bundled: false, predicted: null, fresh: { commitId: 201n, revealed: false } }))).toEqual({ do: "open", commitId: 201n, revealed: false });
  });
});

describe("another commit took the predicted id", () => {
  it("somebody else's commit at that id is not this wallet's: no number comes from it", () => {
    expect(dailyPlan(look({ slot: { buyer: OTHER, count: 1, revealed: true } }))).toEqual({ do: "wait" });
  });

  it("this wallet's own PACK at that id is not the daily (bought in another tab, between the voucher and the send)", () => {
    expect(dailyPlan(look({ slot: { buyer: ME, count: 5, revealed: false } }))).toEqual({ do: "wait" });
  });

  it("the daily landed at another id: the wallet's reveal named the wrong commit, so the server opens it, with no hold", () => {
    const plan = dailyPlan(look({ slot: { buyer: OTHER, count: 1, revealed: true }, fresh: { commitId: 201n, revealed: false }, unrevealedFor: 0 }));
    expect(plan).toEqual({ do: "open", commitId: 201n, revealed: false });
  });

  it("the predicted slot wins when both are seen", () => {
    expect(dailyPlan(look({ slot: mine(true), fresh: { commitId: 201n, revealed: false } }))).toEqual({ do: "open", commitId: 200n, revealed: true });
  });
});

describe("nothing in sight", () => {
  it("keeps looking: a node a block behind is not an answer", () => {
    expect(dailyPlan(look({ used: false, waited: 0 }))).toEqual({ do: "wait" });
    expect(dailyPlan(look({ used: false, waited: DAILY_LOOK_MS - 1 }))).toEqual({ do: "wait" });
    expect(dailyPlan(look({ used: true, waited: 30_000 }))).toEqual({ do: "wait" });
  });

  it("is gone only when time is up AND the chain says the daily was never used (a batch that reverted whole)", () => {
    expect(dailyPlan(look({ used: false, waited: DAILY_LOOK_MS }))).toEqual({ do: "gone" });
  });

  it("is never gone from time alone: used, or a chain that couldn't be asked, means it waits", () => {
    expect(dailyPlan(look({ used: true, waited: DAILY_LOOK_MS }))).toEqual({ do: "lost" });
    expect(dailyPlan(look({ used: null, waited: DAILY_LOOK_MS }))).toEqual({ do: "lost" });
  });

  it("a commit seen at the last moment still counts", () => {
    expect(dailyPlan(look({ used: false, waited: DAILY_LOOK_MS + 5_000, fresh: { commitId: 201n, revealed: true } }))).toEqual({ do: "open", commitId: 201n, revealed: true });
  });
});

describe("the rule under all of it", () => {
  it("never asks the server to open an unrevealed commit while the wallet's reveal may land", () => {
    for (const unrevealedFor of [0, 1_000, 5_000, DAILY_HOLD_MS - 1]) {
      for (const waited of [0, 10_000, DAILY_LOOK_MS + 1]) {
        const plan = dailyPlan(look({ slot: mine(false), unrevealedFor, waited, used: true }));
        expect(plan.do).toBe("hold");
      }
    }
  });

  it("never names a commit that isn't this wallet's one-letter commit", () => {
    const slots = [null, { buyer: OTHER, count: 1, revealed: true }, { buyer: OTHER, count: 1, revealed: false }, { buyer: ME, count: 5, revealed: true }];
    for (const slot of slots) {
      for (const waited of [0, DAILY_LOOK_MS]) {
        const plan = dailyPlan(look({ slot, waited, used: true }));
        expect("commitId" in plan).toBe(false);
      }
    }
  });
});
