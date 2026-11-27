import { describe, expect, it } from "vitest";
import { adviceKeys, gameWalletAdvice, hideNotice, HIDDEN_NOTICES_MAX, noticeHidden, parseHiddenNotices, type WalletHoldings } from "@/lib/profile/gameWalletAdvice";

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

  it("$WORD alone never triggers a notice: each wallet pays its own fees (starl3xx's screenshot)", () => {
    // On the game wallet, the Farcaster wallet holds only 50M $WORD: nothing to gather.
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings: { [F]: empty, [W]: has({ word: 50_000_000 }), [V]: empty } }).kind).toBe("none");
    // On a non-game wallet that holds only $WORD: nothing to move.
    expect(gameWalletAdvice({ ...base, connected: W, gameWallet: F, holdings: { [F]: has({ letters: 2 }), [W]: has({ word: 500 }), [V]: empty } }).kind).toBe("switch_to_game");
  });

  it("staked words elsewhere don't need gathering when this wallet is their caretaker", () => {
    const holdings = { [F]: has({ letters: 2 }), [W]: has({ staked: 1 }), [V]: empty };
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings }).kind).toBe("gather");
    expect(gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings, caretakerOf: new Set([W]) }).kind).toBe("none");
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

describe("adviceKeys: what a hidden notice is about", () => {
  const X = "0x4444444444444444444444444444444444444444";
  const gather = (w: WalletHoldings, v: WalletHoldings = empty) =>
    gameWalletAdvice({ ...base, connected: F, gameWallet: F, holdings: { [F]: has({ letters: 9 }), [W]: w, [V]: v } });
  /** What a browser holds after hiding the notice with these keys. */
  const hiddenWith = (keys: string[]) => hideNotice(null, keys);

  it("ignores counts and case, and names each wallet", () => {
    const a = adviceKeys(gather(has({ letters: 5 })), F, base.wallets);
    expect(a).toEqual(adviceKeys(gather(has({ letters: 6, word: 50 })), F.toUpperCase().replace("0X", "0x"), base.wallets));
    expect(a).toHaveLength(1);
    expect(a[0]).toContain(W);
    expect(adviceKeys(gather(has({ letters: 5 }), has({ words: 1 })), F, base.wallets)).toHaveLength(2);
  });

  it("stays hidden with less to say, and comes back for a wallet it never named", () => {
    // gather: hidden naming W and V; V emptied → still hidden; hidden naming W, then V holds things → back
    const both = hiddenWith(adviceKeys(gather(has({ letters: 5 }), has({ words: 1 })), F, base.wallets));
    expect(noticeHidden(both, adviceKeys(gather(has({ letters: 5 })), F, base.wallets))).toBe(true);
    const onlyW = hiddenWith(adviceKeys(gather(has({ letters: 5 })), F, base.wallets));
    expect(noticeHidden(onlyW, adviceKeys(gather(has({ letters: 5 }), has({ words: 1 })), F, base.wallets))).toBe(false);

    // choose names no wallet, so each linked wallet: unlinking one keeps it hidden, linking one is news
    const choose = gameWalletAdvice({ ...base, connected: F, gameWallet: null, holdings: { [F]: has({ letters: 1 }), [W]: has({ letters: 1 }), [V]: empty } });
    expect(choose.kind).toBe("choose");
    const chose = hiddenWith(adviceKeys(choose, F, base.wallets));
    expect(noticeHidden(chose, adviceKeys(choose, F, [F, W]))).toBe(true);
    expect(noticeHidden(chose, adviceKeys(choose, F, [...base.wallets, X]))).toBe(false);
  });

  it("is its own for each kind and each connected wallet", () => {
    const gathered = hiddenWith(adviceKeys(gather(has({ letters: 5 })), F, base.wallets));
    const move = gameWalletAdvice({ ...base, connected: W, gameWallet: F, holdings: { [F]: empty, [W]: has({ letters: 5 }), [V]: empty } });
    expect(move.kind).toBe("move_to_game");
    expect(noticeHidden(gathered, adviceKeys(move, W, base.wallets))).toBe(false);
    const sw = gameWalletAdvice({ ...base, connected: V, gameWallet: F, holdings: { [F]: has({ letters: 5 }), [W]: empty, [V]: empty } });
    expect(sw.kind).toBe("switch_to_game");
    const switched = hiddenWith(adviceKeys(sw, V, base.wallets));
    expect(noticeHidden(switched, adviceKeys(sw, V, base.wallets))).toBe(true);
    expect(noticeHidden(switched, adviceKeys({ ...sw }, W, base.wallets))).toBe(false);
  });

  it("is empty for no notice, which nothing can hide, so loading never clears a hidden one", () => {
    expect(adviceKeys({ kind: "none" }, F, base.wallets)).toEqual([]);
    expect(noticeHidden(hiddenWith(["anything"]), [])).toBe(false);
  });
});

describe("the hidden notices kept in a browser", () => {
  it("reads anything unreadable as none hidden", () => {
    expect(parseHiddenNotices(null)).toEqual([]);
    expect(parseHiddenNotices("not json")).toEqual([]);
    expect(parseHiddenNotices('{"a":1}')).toEqual([]);
    expect(parseHiddenNotices('["a", 2, "b"]')).toEqual(["a", "b"]);
    expect(noticeHidden("not json", ["a"])).toBe(false);
  });

  it("keeps each key once, the newest last, and drops the oldest past the limit", () => {
    let raw: string | null = null;
    raw = hideNotice(raw, ["a"]);
    raw = hideNotice(raw, ["b", "c"]);
    raw = hideNotice(raw, ["a"]);
    expect(parseHiddenNotices(raw)).toEqual(["b", "c", "a"]);
    for (let i = 0; i < HIDDEN_NOTICES_MAX; i++) raw = hideNotice(raw, [`k${i}`]);
    const kept = parseHiddenNotices(raw);
    expect(kept).toHaveLength(HIDDEN_NOTICES_MAX);
    expect(kept).not.toContain("b");
    expect(kept.at(-1)).toBe(`k${HIDDEN_NOTICES_MAX - 1}`);
  });
});
