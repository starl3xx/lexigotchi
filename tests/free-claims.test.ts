import { describe, expect, it } from "vitest";
import { keyOwnedByProfile } from "@/lib/db/freeClaims";

const W = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"];
const answer = (fids: Record<string, number[]>, answered = true) => async () => ({ fids: new Map(Object.entries(fids)), answered });

describe("keyOwnedByProfile: only the profile's own keys are recorded on it", () => {
  it("an X or Coinbase key the route derived from the profile is the profile's", async () => {
    expect(await keyOwnedByProfile({ fid: null, derivedFromProfile: true, accountWallets: W, lookup: answer({}) })).toBe(true);
    expect(await keyOwnedByProfile({ fid: null, derivedFromProfile: false, accountWallets: W, lookup: answer({}) })).toBe(false);
  });

  it("a FID that verified one of the profile's wallets is the profile's", async () => {
    expect(await keyOwnedByProfile({ fid: 7, derivedFromProfile: true, accountWallets: W, lookup: answer({ [W[1]]: [7] }) })).toBe(true);
  });

  it("a stranger's FID naming the profile's wallet is not (Bugbot on #178)", async () => {
    expect(await keyOwnedByProfile({ fid: 99, derivedFromProfile: true, accountWallets: W, lookup: answer({ [W[1]]: [7] }) })).toBe(false);
    expect(await keyOwnedByProfile({ fid: 99, derivedFromProfile: true, accountWallets: W, lookup: answer({}) })).toBe(false);
  });

  it("when Farcaster couldn't answer in full, a FID counts (the backstop is for exactly that case)", async () => {
    expect(await keyOwnedByProfile({ fid: 99, derivedFromProfile: true, accountWallets: W, lookup: answer({}, false) })).toBe(true);
    const throws = async () => {
      throw new Error("down");
    };
    expect(await keyOwnedByProfile({ fid: 99, derivedFromProfile: true, accountWallets: W, lookup: throws })).toBe(true);
  });
});
