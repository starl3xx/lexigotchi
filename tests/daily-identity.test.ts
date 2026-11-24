import { describe, expect, it } from "vitest";
import { keysFrom } from "@/lib/onchain/dailyIdentity";
import { verifiedDailyKey, xDailyKey } from "@/lib/onchain/verifications";

describe("the keys one player could pull under", () => {
  it("covers a FID the request didn't sign in with, every wallet of it, and their X accounts", () => {
    const w1 = "0x1111111111111111111111111111111111111111", w2 = "0x2222222222222222222222222222222222222222";
    const keys = keysFrom([77], [w1, w2.toUpperCase().replace("0X", "0x")], ["1234567890123456789"]);
    expect(keys).toEqual([77n, verifiedDailyKey(w1), verifiedDailyKey(w2), xDailyKey("1234567890123456789")]);
  });
  it("lists each key once", () => {
    const w = "0x1111111111111111111111111111111111111111";
    expect(keysFrom([5, 5], [w, w], [])).toEqual([5n, verifiedDailyKey(w)]);
  });
});
