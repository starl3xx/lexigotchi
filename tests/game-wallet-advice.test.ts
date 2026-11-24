import { describe, expect, it } from "vitest";
import { gameWalletAdvice, type WalletHoldings } from "@/lib/profile/gameWalletAdvice";

// Made-up wallets: F = the first wallet (web), W = the Farcaster in-app wallet, V = another.
const F = "0x1111111111111111111111111111111111111111";
const W = "0x2222222222222222222222222222222222222222";
const V = "0x3333333333333333333333333333333333333333";
const empty: WalletHoldings = { letters: 0, words: 0, staked: 0, word: 0 };
const has = (p: Partial<WalletHoldings>): WalletHoldings => ({ ...empty, ...p });
const base = { wallets: [F, W, V], inHost: false };

describe("gameWalletAdvice", () => {
  it("the screenshot case: everything in the first wallet, inside Farcaster on an empty wallet, nothing chosen → choose", () => {
    const a = gameWalletAdvice({
      ...base,
      inHost: true,
      connected: W,
      gameWallet: null,
      holdings: { [F]: has({ letters: 7, words: 3 }), [W]: empty, [V]: empty },
    });
    expect(a.kind).toBe("choose");
  });

  it("same, after choosing the Farcaster wallet → switch can't happen in Farcaster: says so, and names the game wallet's things to move", () => {
    const a = gameWalletAdvice({
      ...base,
      inHost: true,
      connected: W,
      gameWallet: W,
      holdings: { [F]: has({ letters: 7, words: 3 }), [W]: empty, [V]: empty },
    });
    expect(a).toEqual({ kind: "gather", elsewhere: [{ wallet: F, holdings: has({ letters: 7, words: 3 }) }], inHost: true });
  });

  it("same, after choosing the first wallet → inside Farcaster on an empty wallet: switch_to_game (in host)", () => {
    const a = gameWalletAdvice({
      ...base,
      inHost: true,
      connected: W,
      gameWallet: F,
      holdings: { [F]: has({ letters: 7, words: 3 }), [W]: empty, [V]: empty },
    });
    expect(a).toMatchObject({ kind: "switch_to_game", game: F, inHost: true });
  });

  it("connected isn't the game wallet and holds things (a daily letter landed here) → move them to the game wallet", () => {
    const a = gameWalletAdvice({
      ...base,
      connected: W,
      gameWallet: F,
      holdings: { [F]: has({ letters: 7 }), [W]: has({ letters: 1 }), [V]: empty },
    });
    expect(a).toEqual({ kind: "move_to_game", from: W, to: F, holdings: has({ letters: 1 }) });
  });

  it("$WORD alone counts: a game wallet with no $WORD can't pay for anything", () => {
    const a = gameWalletAdvice({ ...base, connected: W, gameWallet: F, holdings: { [F]: empty, [W]: has({ word: 500 }), [V]: empty } });
    expect(a.kind).toBe("move_to_game");
  });

  it("staked words elsewhere keep the gather notice up: only their wallet can feed them", () => {
    const a = gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings: { [F]: has({ letters: 2 }), [W]: has({ staked: 1 }), [V]: empty } });
    expect(a).toMatchObject({ kind: "gather", elsewhere: [{ wallet: W }] });
  });

  it("says nothing when it doesn't matter", () => {
    // everything in the connected wallet, nothing chosen
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: null, holdings: { [F]: has({ letters: 3 }), [W]: empty, [V]: empty } }).kind).toBe("none");
    // playing from the game wallet, nothing elsewhere
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings: { [F]: has({ letters: 3 }), [W]: empty, [V]: empty } }).kind).toBe("none");
    // one wallet only
    expect(gameWalletAdvice({ wallets: [F], inHost: false, connected: F, gameWallet: null, holdings: { [F]: has({ letters: 3 }) } }).kind).toBe("none");
    // holdings not read yet
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: null, holdings: { [F]: has({ letters: 3 }) } }).kind).toBe("none");
    // a stale choice (the wallet left the account) reads as no choice
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: "0x9999999999999999999999999999999999999999", holdings: { [F]: has({ letters: 3 }), [W]: has({ letters: 1 }), [V]: empty } }).kind).toBe("choose");
  });
});
