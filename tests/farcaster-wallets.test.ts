import { describe, expect, it } from "vitest";
import { chooseAccountForFid, planFarcasterWallets, resolveSyncAccount, type LinkRowFull } from "@/lib/profile/farcasterWallets";

// Made-up wallets and FIDs: never anyone's real account.
const A = "0xaaaa000000000000000000000000000000000001"; // the account's first wallet
const S = "0xaaaa000000000000000000000000000000000002"; // linked by signature
const W = "0xaaaa000000000000000000000000000000000003"; // Farcaster-verified, not linked yet
const X = "0xaaaa000000000000000000000000000000000004"; // another Farcaster-verified wallet
const O = "0xbbbb000000000000000000000000000000000001"; // someone else's account
const none = new Set<string>();
const sig = (address: string, account = A): LinkRowFull => ({ address, account, via: "signature", fid: null });
const fc = (address: string, fid: number, account = A): LinkRowFull => ({ address, account, via: "farcaster", fid });

describe("planFarcasterWallets", () => {
  it("adopts every wallet a FID verified when that FID also verified a seed", () => {
    const plan = planFarcasterWallets({ account: A, rows: [], fidWallets: new Map([[7, [A, W, X]]]), hasOwnProfile: none });
    expect(plan.adopt).toEqual([{ address: W, fid: 7 }, { address: X, fid: 7 }]);
  });

  it("a signature link vouches too (Farcaster verified S, not the first wallet)", () => {
    const plan = planFarcasterWallets({ account: A, rows: [sig(S)], fidWallets: new Map([[7, [S, W]]]), hasOwnProfile: none });
    expect(plan.adopt).toEqual([{ address: W, fid: 7 }]);
  });

  it("never chains: a wallet that joined through Farcaster vouches for nothing", () => {
    // W joined through FID 7; FID 9 verified W and X, but no seed.
    const plan = planFarcasterWallets({
      account: A,
      rows: [fc(W, 7)],
      fidWallets: new Map([[7, [A, W]], [9, [W, X]]]),
      hasOwnProfile: none,
    });
    expect(plan.adopt).toEqual([]);
  });

  it("never merges: a wallet in another account, heading one, or with its own profile stays put", () => {
    const H = "0xcccc000000000000000000000000000000000001"; // heads an account (O... no: its own)
    const plan = planFarcasterWallets({
      account: A,
      rows: [sig(W, O), sig("0xcccc000000000000000000000000000000000002", H)],
      fidWallets: new Map([[7, [A, W, H, X]]]),
      hasOwnProfile: new Set([X]),
    });
    expect(plan.adopt).toEqual([]);
    expect(plan.skipped).toEqual([
      { address: W, reason: "linked_elsewhere" },
      { address: H, reason: "has_wallets" },
      { address: X, reason: "has_profile" },
    ]);
  });

  it("stops at five wallets, in a fixed order", () => {
    const many = Array.from({ length: 6 }, (_, i) => `0xdddd00000000000000000000000000000000000${i}`);
    const plan = planFarcasterWallets({ account: A, rows: [], fidWallets: new Map([[7, [A, ...many]]]), hasOwnProfile: none });
    expect(plan.adopt.map((a) => a.address)).toEqual(many.slice(0, 4));
    expect(plan.skipped.filter((s) => s.reason === "too_many").map((s) => s.address)).toEqual(many.slice(4));
  });

  it("prunes a Farcaster link only on a positive answer that no longer verifies it", () => {
    const rows = [fc(W, 7), fc(X, 8)];
    // FID 7 answered without W; FID 8 didn't answer at all (an outage): X stays.
    const plan = planFarcasterWallets({ account: A, rows, fidWallets: new Map([[7, [A]]]), hasOwnProfile: none });
    expect(plan.prune).toEqual([W]);
  });

  it("prunes when the FID no longer verifies any seed, and never on a held day", () => {
    const rows = [fc(W, 7)];
    const gone = new Map([[7, [W]]]); // still verifies W, but not A anymore
    expect(planFarcasterWallets({ account: A, rows, fidWallets: gone, hasOwnProfile: none }).prune).toEqual([W]);
    expect(planFarcasterWallets({ account: A, rows, fidWallets: gone, hasOwnProfile: none, holdPrune: true }).prune).toEqual([]);
  });

  it("never prunes a signature link", () => {
    const plan = planFarcasterWallets({ account: A, rows: [sig(S)], fidWallets: new Map([[7, [A]]]), hasOwnProfile: none });
    expect(plan.prune).toEqual([]);
  });
});

describe("chooseAccountForFid (a Farcaster sign-in with no wallet signature)", () => {
  it("builds on an account one of the FID's wallets is already in", () => {
    expect(chooseAccountForFid([W, X], [sig(X, A)], none)).toBe(A);
  });

  it("else on the one wallet with its own profile, else the lowest wallet, whoever asks", () => {
    expect(chooseAccountForFid([X, W], [], new Set([X]))).toBe(X);
    expect(chooseAccountForFid([X, W], [], none)).toBe(W);
    expect(chooseAccountForFid([], [], none)).toBeNull();
  });
});

describe("resolveSyncAccount: the same account whichever wallet signs in first", () => {
  // FID verified P (holds the player's X or email), W, and R. All three are bare of links.
  const P = "0xeeee000000000000000000000000000000000003";
  const W = "0xeeee000000000000000000000000000000000001";
  const R = "0xeeee000000000000000000000000000000000002";
  const verified = [P, W, R];
  const profile = new Set([P]);

  it("a bare wallet session builds where a Farcaster sign-in would (on P), not on itself", () => {
    const fromW = resolveSyncAccount({ sessionWallet: W, sessionAccount: W, verified, rows: [], hasOwnProfile: profile });
    const fromP = resolveSyncAccount({ sessionWallet: P, sessionAccount: P, verified, rows: [], hasOwnProfile: profile });
    const fromFid = resolveSyncAccount({ verified, rows: [], hasOwnProfile: profile });
    expect([fromW, fromP, fromFid]).toEqual([P, P, P]);
    // …and P's plan then takes in W and R.
    const plan = planFarcasterWallets({ account: P, rows: [], fidWallets: new Map([[7, verified]]), hasOwnProfile: profile });
    expect(plan.adopt.map((a) => a.address).sort()).toEqual([R, W].sort());
  });

  it("a wallet with a real account keeps it", () => {
    const rows: LinkRowFull[] = [{ address: "0xffff000000000000000000000000000000000001", account: W, via: "signature", fid: null }];
    expect(resolveSyncAccount({ sessionWallet: W, sessionAccount: W, verified, rows, hasOwnProfile: profile })).toBe(W);
    expect(resolveSyncAccount({ sessionWallet: R, sessionAccount: P, verified, rows: [], hasOwnProfile: profile })).toBe(P);
  });
});
