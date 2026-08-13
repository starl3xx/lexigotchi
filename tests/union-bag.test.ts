import { describe, it, expect } from "vitest";
import { bagWalletsOf, unionWords, sumLetterCounts } from "@/lib/onchain/unionBag";
import type { ChainWord } from "@/lib/onchain/reads";

const CONNECTED = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const LINKED = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const word = (w: string, tokenId: bigint): ChainWord => ({
  word: w,
  tokenId,
  upper: [false, false, false, false, false],
  staked: false,
  daysUnfed: 0,
  prestigeLevel: 0,
});

describe("bagWalletsOf — one bag's wallet set", () => {
  it("puts the connected wallet first and dedupes case-insensitively", () => {
    const bag = bagWalletsOf(CONNECTED, [CONNECTED.toUpperCase().replace("0X", "0x"), LINKED]);
    expect(bag).toEqual([CONNECTED.toLowerCase(), LINKED]);
  });

  it("is just the connected wallet when nothing is linked", () => {
    expect(bagWalletsOf(CONNECTED, null)).toEqual([CONNECTED.toLowerCase()]);
    expect(bagWalletsOf(CONNECTED, [])).toEqual([CONNECTED.toLowerCase()]);
  });

  it("is empty with no connection — the bag needs a wallet to exist", () => {
    expect(bagWalletsOf(undefined, [LINKED])).toEqual([LINKED]);
    expect(bagWalletsOf(undefined, null)).toEqual([]);
  });
});

describe("unionWords — one collection per human", () => {
  it("merges wallets and tags mine/holder correctly", () => {
    const out = unionWords(
      [
        { wallet: CONNECTED.toLowerCase() as `0x${string}`, words: [word("ABOUT", 1n)] },
        { wallet: LINKED as `0x${string}`, words: [word("CRANE", 2n)] },
      ],
      CONNECTED,
    );
    expect(out).toHaveLength(2);
    const about = out.find((w) => w.word === "ABOUT")!;
    const crane = out.find((w) => w.word === "CRANE")!;
    expect(about.mine).toBe(true);
    expect(crane.mine).toBe(false);
    expect(crane.holder).toBe(LINKED);
  });

  it("dedupes by tokenId with the CONNECTED wallet's attribution winning", () => {
    // Mid-transfer, two reads can briefly both claim a word. `mine` must err toward what a
    // transaction would find — the connected wallet's view.
    const out = unionWords(
      [
        { wallet: LINKED as `0x${string}`, words: [word("ABOUT", 1n)] },
        { wallet: CONNECTED.toLowerCase() as `0x${string}`, words: [word("ABOUT", 1n)] },
      ],
      CONNECTED,
    );
    expect(out).toHaveLength(1);
    expect(out[0].mine).toBe(true);
  });

  it("everything is mine when the bag is a single wallet", () => {
    const out = unionWords(
      [{ wallet: CONNECTED.toLowerCase() as `0x${string}`, words: [word("ABOUT", 1n), word("CRANE", 2n)] }],
      CONNECTED,
    );
    expect(out.every((w) => w.mine)).toBe(true);
  });
});

describe("sumLetterCounts", () => {
  it("sums element-wise across 52 slots and tolerates short arrays", () => {
    const a = Array.from({ length: 52 }, (_, i) => i);
    const b = Array.from({ length: 52 }, () => 1);
    const sum = sumLetterCounts([a, b]);
    expect(sum[0]).toBe(1);
    expect(sum[51]).toBe(52);
    // A failed linked-wallet read degrades to [] — the union must not NaN.
    expect(sumLetterCounts([a, []])).toEqual(a);
    expect(sumLetterCounts([])).toEqual(Array.from({ length: 52 }, () => 0));
  });
});
