/**
 * The deal alert (lib/notify/deals.ts; decisions.md #47, part 4): "A q is for sale on the Market.
 * It finishes QUICK, a word nobody owns." It must be TRUE when it arrives, and it must not nag.
 */
import { describe, it, expect } from "vitest";
import { bestDeal, dealMark, dealNote, dealNotes, type DealDeps } from "@/lib/notify/deals";
import type { LetterBook } from "@/lib/market/types";
import { WORDS } from "@/lib/dictionary";

const A = "0x00000000000000000000000000000000000000aa";
const A2 = "0x00000000000000000000000000000000000000a2";
const SELLER = "0x00000000000000000000000000000000000000cc";
const id = (ch: string, upper = false) => ch.toUpperCase().charCodeAt(0) - 65 + (upper ? 26 : 0);
/** 52 counts from letters: lowercase as written, UPPERCASE in capitals. */
const bag = (letters: string) => {
  const n = new Array<number>(52).fill(0);
  for (const ch of letters) n[id(ch, ch === ch.toUpperCase())]++;
  return n;
};
const ask = (letterId: number, unitPrice: number, maker = SELLER) => ({ orderHash: `0x${letterId}${unitPrice}`, maker, letterId, unitPrice, available: 1, listedAt: "" });
const book = (...asks: ReturnType<typeof ask>[]): Record<number, LetterBook> => {
  const b: Record<number, LetterBook> = {};
  for (const a of asks) (b[a.letterId] ??= { asks: [], more: false }).asks.push(a);
  return b;
};
const notMine = () => false;
// every dictionary word is unowned unless a test says otherwise
const unclaimed = WORDS;

describe("bestDeal", () => {
  it("finds the letter for sale that finishes a word nobody owns, for the wallet that holds the other four", () => {
    const pick = bestDeal([{ wallet: A, letters: bag("unbo") }], unclaimed, book(ask(id("x"), 9_800_000)), notMine)!;
    expect(pick).toMatchObject({ wallet: A, letter: "x", word: "UNBOX", from: 9_800_000 });
  });

  it("is nothing when the letter isn’t for sale, or the word has an owner", () => {
    expect(bestDeal([{ wallet: A, letters: bag("unbo") }], unclaimed, book(), notMine)).toBeNull();
    const owned = WORDS.filter((w) => w !== "UNBOX");
    expect(bestDeal([{ wallet: A, letters: bag("unbo") }], owned, book(ask(id("x"), 9_800_000)), notMine)?.word).not.toBe("UNBOX");
  });

  it("never points at the player’s own listing", () => {
    const mine = (maker: string) => maker === A2;
    expect(bestDeal([{ wallet: A, letters: bag("unbo") }], unclaimed, book(ask(id("x"), 1_000_000, A2)), mine)).toBeNull();
    // someone else's dearer listing of the same letter is the one that counts
    expect(bestDeal([{ wallet: A, letters: bag("unbo") }], unclaimed, book(ask(id("x"), 1_000_000, A2), ask(id("x"), 9_800_000)), mine)?.from).toBe(9_800_000);
  });

  it("never adds two wallets’ letters up: a claim spends from one wallet", () => {
    // "un" in one wallet and "bo" in the other spell nothing together
    const pick = bestDeal([{ wallet: A, letters: bag("un") }, { wallet: A2, letters: bag("bo") }], unclaimed, book(ask(id("x"), 9_800_000)), notMine);
    expect(pick?.word).not.toBe("UNBOX");
  });

  it("never offers to sell a player a letter they hold in another wallet: that is a move", () => {
    const pick = bestDeal([{ wallet: A, letters: bag("unbo") }, { wallet: A2, letters: bag("x") }], unclaimed, book(ask(id("x"), 9_800_000)), notMine);
    expect(pick?.letter).not.toBe("x");
  });

  it("takes either case of the letter, at the lower ask", () => {
    const pick = bestDeal([{ wallet: A, letters: bag("unbo") }], unclaimed, book(ask(id("x"), 9_800_000), ask(id("x", true), 4_000_000)), notMine)!;
    expect(pick.from).toBe(4_000_000);
  });

  it("names the rarest word the letter finishes, and counts the rest", () => {
    const pick = bestDeal([{ wallet: A, letters: bag("unboaeilrst") }], unclaimed, book(ask(id("x"), 9_800_000)), notMine)!;
    expect(pick.letter).toBe("x");
    expect(pick.more).toBeGreaterThan(0);
    expect(WORDS).toContain(pick.word);
  });
});

describe("the message", () => {
  const pick = { wallet: A, letter: "x", word: "UNBOX", more: 2, from: 9_800_000 };
  it("says the letter, where from, the word it finishes, and that nobody owns it", () => {
    const n = dealNote(A, pick, 2968);
    expect(n.note.body).toBe("An x is for sale on the Market, from 9.80M $WORD. It finishes UNBOX, a word nobody owns, and 2 more.");
    expect(n.note.notificationId).toBe("deal-x-unbox-2968");
    expect(n.facts).toEqual([["Letter", "x"], ["From", "9.80M $WORD"], ["Finishes", "UNBOX"]]);
    expect(dealNote(A, { ...pick, letter: "q", word: "QUICK", more: 0 }, 2968).note.body).toBe("A q is for sale on the Market, from 9.80M $WORD. It finishes QUICK, a word nobody owns.");
  });
});

describe("dealNotes: once a day at most, and the same deal once a week", () => {
  function deps(over: Partial<DealDeps> = {}) {
    const marks = new Set<string>();
    const d: DealDeps = {
      accounts: [A],
      walletsOf: (account) => (account === A ? [A, A2] : [account]),
      accountOf: (address) => (address.toLowerCase() === A2 ? A : address.toLowerCase()),
      lettersOf: async () => ({ [A]: bag("unbo"), [A2]: bag("") }),
      unclaimed,
      book: book(ask(id("x"), 9_800_000)),
      claim: async (account, mark) => (marks.has(`${account}|${mark}`) ? "taken" : (marks.add(`${account}|${mark}`), "claimed")),
      ...over,
    };
    return { d, marks };
  }

  it("tells an opted-in player of their best deal", async () => {
    const { d, marks } = deps();
    const notes = await dealNotes(d, 2968);
    expect(notes.map((n) => [n.account, n.wallet, n.note.notificationId])).toEqual([[A, A, "deal-x-unbox-2968"]]);
    expect([...marks]).toEqual([`${A}|${dealMark({ letter: "x", word: "UNBOX" }, 2968)}`]);
  });

  it("doesn’t say the same deal again this week, and says it again next week if it still stands", async () => {
    const { d } = deps();
    expect(await dealNotes(d, 2968)).toHaveLength(1);
    expect(await dealNotes(d, 2968)).toHaveLength(0);
    expect(await dealNotes(d, 2969)).toHaveLength(1);
  });

  it("sends nothing while the throttle can’t be kept (the migration hasn’t run)", async () => {
    const { d } = deps({ claim: async () => "unavailable" });
    expect(await dealNotes(d, 2968)).toEqual([]);
  });

  it("a dry run picks without using up the player’s alert", async () => {
    const { d, marks } = deps();
    expect(await dealNotes(d, 2968, { dry: true })).toHaveLength(1);
    expect(marks.size).toBe(0);
  });

  it("asks nothing of the chain when nobody opted in", async () => {
    let asked = false;
    const { d } = deps({ accounts: [], lettersOf: async () => ((asked = true), {}) });
    expect(await dealNotes(d, 2968)).toEqual([]);
    expect(asked).toBe(false);
  });
});
