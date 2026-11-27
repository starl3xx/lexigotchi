/**
 * Who a set's first day is open to (lib/sets/firstDay.ts; decisions.md, "Collab sets", item 4):
 * every verified player, the wallets on a list, or the holders of a token on Base. The rule fails
 * closed: a read that fails is "ask again", never "yes".
 */
import { describe, it, expect } from "vitest";
import { firstDayOpenTo, tokenReadable, type FirstDayDeps, type FirstDaySet } from "@/lib/sets/firstDay";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const TOKEN = "0x4444444444444444444444444444444444444444";

const set = (over: Partial<FirstDaySet>): FirstDaySet => ({ id: 7, gateRule: "verified", gateToken: null, gateMin: null, ...over });
const deps = (over: Partial<FirstDayDeps> = {}): FirstDayDeps => ({
  onAllowlist: async () => {
    throw new Error("not asked in this test");
  },
  balanceOf: async () => {
    throw new Error("not asked in this test");
  },
  ...over,
});

describe("every verified player", () => {
  it("is open, and asks nothing", async () => {
    expect(await firstDayOpenTo(set({}), [A], deps())).toBe(true);
  });
});

describe("an allowlist", () => {
  const listed = (on: string[]) => deps({ onAllowlist: async (id, wallets) => id === 7 && wallets.some((w) => on.includes(w)) });
  it("lets in a player with ANY wallet on the list", async () => {
    expect(await firstDayOpenTo(set({ gateRule: "allowlist" }), [A, B], listed([B]))).toBe(true);
    expect(await firstDayOpenTo(set({ gateRule: "allowlist" }), [A], listed([B]))).toBe(false);
  });
  it("a player with no wallet is on no list", async () => {
    expect(await firstDayOpenTo(set({ gateRule: "allowlist" }), [], listed([A]))).toBe(false);
  });
  it("a list that can't be read is unknown", async () => {
    const down = deps({
      onAllowlist: async () => {
        throw new Error("db down");
      },
    });
    expect(await firstDayOpenTo(set({ gateRule: "allowlist" }), [A], down)).toBeNull();
  });
});

describe("a token's holders", () => {
  const rule = set({ gateRule: "token", gateToken: TOKEN, gateMin: "100" });
  const holding = (of: Record<string, bigint | Error>) =>
    deps({
      balanceOf: async (token, wallet) => {
        expect(token).toBe(TOKEN);
        const v = of[wallet] ?? 0n;
        if (v instanceof Error) throw v;
        return v;
      },
    });
  it("lets in a player with a wallet that holds the minimum or more", async () => {
    expect(await firstDayOpenTo(rule, [A, B], holding({ [A]: 99n, [B]: 100n }))).toBe(true);
    expect(await firstDayOpenTo(rule, [A, B], holding({ [A]: 99n, [B]: 99n }))).toBe(false); // each wallet alone, never added up
  });
  it("a balance that can't be read is unknown, unless another wallet already holds enough", async () => {
    expect(await firstDayOpenTo(rule, [A, B], holding({ [A]: new Error("rpc"), [B]: 5n }))).toBeNull();
    expect(await firstDayOpenTo(rule, [A, B], holding({ [A]: new Error("rpc"), [B]: 100n }))).toBe(true);
  });
  it("a rule that is missing a part lets nobody in", async () => {
    const rich = holding({ [A]: 10n ** 30n });
    expect(await firstDayOpenTo(set({ gateRule: "token", gateToken: null, gateMin: "1" }), [A], rich)).toBe(false);
    expect(await firstDayOpenTo(set({ gateRule: "token", gateToken: TOKEN, gateMin: null }), [A], rich)).toBe(false);
    expect(await firstDayOpenTo(set({ gateRule: "token", gateToken: TOKEN, gateMin: "0" }), [A], rich)).toBe(false);
    expect(await firstDayOpenTo(set({ gateRule: "token", gateToken: TOKEN, gateMin: "1e18" }), [A], rich)).toBe(false);
  });
  it("counts a balance past what a JavaScript number holds", async () => {
    const big = set({ gateRule: "token", gateToken: TOKEN, gateMin: "1000000000000000000000" }); // 1,000 tokens of 18 decimals
    expect(await firstDayOpenTo(big, [A], holding({ [A]: 999_999_999_999_999_999_999n }))).toBe(false);
    expect(await firstDayOpenTo(big, [A], holding({ [A]: 1_000_000_000_000_000_000_000n }))).toBe(true);
  });
});

describe("a token rule's contract, before a release is built for it", () => {
  it("is readable when balanceOf answers, whatever the answer", async () => {
    expect(await tokenReadable(TOKEN, { balanceOf: async () => 0n })).toBe(true);
  });
  it("is not when the read fails: a mistyped address, or a contract that isn't a token", async () => {
    const asked: string[] = [];
    const bad = {
      balanceOf: async (_t: string, wallet: string) => {
        asked.push(wallet);
        throw new Error("execution reverted");
      },
    };
    expect(await tokenReadable(TOKEN, bad)).toBe(false);
    expect(asked).toEqual(["0x000000000000000000000000000000000000dead"]); // never the zero address: an ERC-721 reverts on it
  });
});
