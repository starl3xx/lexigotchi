import { describe, expect, it } from "vitest";
import { BASE_VERIFY_KEY_FLOOR, VERIFIED_KEY_FLOOR, X_KEY_FLOOR, dailyKeysFor, verifiedDailyKey, xDailyKey } from "@/lib/onchain/verifications";

const WALLET = "0x1111111111111111111111111111111111111111";
const MAX_FID = (1n << 32n) - 1n;

describe("the X daily key range", () => {
  it("is pinned at 2^162, above the verified-wallet and reserved Base Verify ranges", () => {
    expect(X_KEY_FLOOR).toBe(1n << 162n);
    expect(BASE_VERIFY_KEY_FLOOR).toBe(1n << 161n);
    expect(VERIFIED_KEY_FLOOR).toBe(1n << 160n);
  });
  it("keeps every X id disjoint from FIDs, verified wallets, and Base Verify", () => {
    const lowest = xDailyKey("0");
    const highest = xDailyKey(((1n << 64n) - 1n).toString());
    expect(lowest).toBe(X_KEY_FLOOR);
    expect(highest).toBe(X_KEY_FLOOR + (1n << 64n) - 1n);
    expect(lowest > MAX_FID).toBe(true);
    expect(lowest > verifiedDailyKey("0xffffffffffffffffffffffffffffffffffffffff")).toBe(true);
    expect(lowest >= BASE_VERIFY_KEY_FLOOR * 2n).toBe(true); // past the whole [2^161, 2^162) reservation
    // An X id that equals a real FID still lands in its own range.
    expect(xDailyKey("12345")).not.toBe(12345n);
  });
  it("refuses anything that isn't a 64-bit X id", () => {
    expect(() => xDailyKey("abc")).toThrow();
    expect(() => xDailyKey("-1")).toThrow();
    expect(() => xDailyKey((1n << 64n).toString())).toThrow();
    expect(() => xDailyKey("")).toThrow();
  });
});

describe("which key today's daily uses, and which keys count as claimed", () => {
  const x = "1234567890123456789";
  it("puts Farcaster first, then an X old enough to count, then the wallet", () => {
    expect(dailyKeysFor({ fid: 99, xUserId: x, xCounts: true, wallet: WALLET }).primary).toBe(99n);
    expect(dailyKeysFor({ xUserId: x, xCounts: true, wallet: WALLET }).primary).toBe(xDailyKey(x));
    expect(dailyKeysFor({ xUserId: x, xCounts: false, wallet: WALLET }).primary).toBe(verifiedDailyKey(WALLET));
    expect(dailyKeysFor({}).primary).toBeNull();
  });
  it("lists every linked key, so a pull on any of them is today's one letter", () => {
    expect(dailyKeysFor({ fid: 99, xUserId: x, xCounts: false, wallet: WALLET }).all).toEqual([99n, xDailyKey(x), verifiedDailyKey(WALLET)]);
    expect(dailyKeysFor({ wallet: WALLET }).all).toEqual([verifiedDailyKey(WALLET)]);
  });
});
