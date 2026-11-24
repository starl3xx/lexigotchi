import { describe, expect, it } from "vitest";
import { keysFrom, relatedKeysFrom } from "@/lib/onchain/dailyIdentity";
import { isDailyDue } from "@/lib/notify/triggers";
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

describe("the walk across linked wallets (relatedKeysFrom: the daily route and the reminder cron)", () => {
  // Made-up: A heads an account that B joined. B is verified by FID 7, which also verified W.
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const W = "0x4444444444444444444444444444444444444444";
  const fidsOfWallet = new Map([[B, [7]]]);
  const walletsOfFid = new Map([[7, [B, W]]]);
  const xIdOfWallet = new Map([[A, "42"]]);

  it("covers every wallet of the account, their FIDs, those FIDs' wallets, and the account's X", () => {
    const [keys] = relatedKeysFrom([{ fid: null, wallets: [A, B] }], fidsOfWallet, walletsOfFid, xIdOfWallet);
    expect(new Set(keys)).toEqual(new Set([7n, verifiedDailyKey(A), verifiedDailyKey(B), verifiedDailyKey(W), xDailyKey("42")]));
  });

  it("a pull under a linked wallet's Coinbase key means no 'daily ready' reminder for the account", () => {
    const day = 20_000;
    const [keys] = relatedKeysFrom([{ fid: null, wallets: [A, B] }], fidsOfWallet, walletsOfFid, xIdOfWallet);
    // A pulled yesterday (dailyUsed holds day + 1), B pulled today.
    const used = new Map<bigint, number>([[verifiedDailyKey(A), day], [verifiedDailyKey(B), day + 1]]);
    expect(isDailyDue(Math.max(0, ...keys.map((k) => used.get(k) ?? 0)), day)).toBe(false);
    // Without the link, A alone would have been told a letter was waiting.
    const [alone] = relatedKeysFrom([{ fid: null, wallets: [A] }], new Map(), new Map(), xIdOfWallet);
    expect(isDailyDue(Math.max(0, ...alone.map((k) => used.get(k) ?? 0)), day)).toBe(true);
  });

  it("walks each start on its own (batched for the cron)", () => {
    const out = relatedKeysFrom([{ fid: null, wallets: [A] }, { fid: 7, wallets: [W] }], fidsOfWallet, walletsOfFid, xIdOfWallet);
    expect(out[0]).not.toContain(verifiedDailyKey(B));
    expect(out[1]).toContain(verifiedDailyKey(B)); // FID 7's other wallet
  });
});
