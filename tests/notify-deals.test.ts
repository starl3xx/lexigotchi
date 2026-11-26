/**
 * The deal alert (lib/notify/deals.ts; decisions.md #47, part 4): "A q is for sale on the Market.
 * It finishes QUICK, a word nobody owns." It must be TRUE when it arrives, and it must not nag.
 */
import { describe, it, expect } from "vitest";
import { DEAL_AGAIN_SECONDS, bestDeal, dealMark, dealNote, dealNotes, rankedDeals, type DealDeps } from "@/lib/notify/deals";
import { TIER_RANK } from "@/lib/market/deals";
import type { LetterBook } from "@/lib/market/types";
import { WORDS } from "@/lib/dictionary";
import { wordTier } from "@/lib/economy";

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

describe("rankedDeals: the rarer word first, then the lower ask", () => {
  const ranks = Object.values(TIER_RANK);
  const tierAt = (rank: number) => Object.keys(TIER_RANK).find((t) => TIER_RANK[t as keyof typeof TIER_RANK] === rank)!;
  /** A word of this tier whose last letter is nowhere else in it, sharing no letter with `avoid`. */
  const wordOf = (tier: string, avoid = "") => WORDS.find((w) => wordTier(w) === tier && !w.slice(0, 4).includes(w[4]) && ![...w].some((c) => avoid.includes(c)))!;
  /** A wallet holding the first four letters of each word: each word is short of its last letter only. */
  const shortOf = (...words: string[]) => [{ wallet: A, letters: bag(words.map((w) => w.slice(0, 4).toLowerCase()).join("")) }];

  it("a rarer word beats a lower ask", () => {
    const common = wordOf(tierAt(Math.min(...ranks)));
    const rarest = wordOf(tierAt(Math.max(...ranks)), common);
    expect(wordTier(rarest)).not.toBe(wordTier(common));
    const ranked = rankedDeals(shortOf(common, rarest), [common, rarest], book(ask(id(common[4]), 1_000_000), ask(id(rarest[4]), 9_000_000)), notMine);
    expect(ranked.map((p) => p.word)).toEqual([rarest, common]);
    expect(bestDeal(shortOf(common, rarest), [common, rarest], book(ask(id(common[4]), 1_000_000), ask(id(rarest[4]), 9_000_000)), notMine)?.word).toBe(rarest);
  });

  it("between two words of one rarity, the lower ask is first", () => {
    const tier = tierAt(Math.min(...ranks));
    const one = wordOf(tier);
    const two = wordOf(tier, one);
    const asked = (first: number, second: number) => rankedDeals(shortOf(one, two), [one, two], book(ask(id(one[4]), first), ask(id(two[4]), second)), notMine).map((p) => p.word);
    expect(asked(5_000_000, 3_000_000)).toEqual([two, one]);
    expect(asked(3_000_000, 5_000_000)).toEqual([one, two]);
  });

  it("is one deal per letter, in order, over the real dictionary", () => {
    const asks = [..."xqzkjvwdmpy"].map((ch, i) => ask(id(ch), (i + 1) * 1_000_000));
    const ranked = rankedDeals([{ wallet: A, letters: bag("unboaeilrst") }], unclaimed, book(...asks), notMine);
    expect(ranked.length).toBeGreaterThan(1);
    expect(new Set(ranked.map((p) => p.letter)).size).toBe(ranked.length);
    for (let i = 1; i < ranked.length; i++) {
      const [a, b] = [ranked[i - 1], ranked[i]];
      const byTier = TIER_RANK[wordTier(a.word)] - TIER_RANK[wordTier(b.word)];
      expect(byTier > 0 || (byTier === 0 && a.from <= b.from)).toBe(true);
    }
  });
});

describe("the message", () => {
  const pick = { wallet: A, letter: "x", word: "UNBOX", more: 2, from: 9_800_000 };
  it("says the letter, where from, the word it finishes, and that nobody owns it", () => {
    const n = dealNote(A, pick, 20783);
    expect(n.note.body).toBe("An x is for sale on the Market, from 9.80M $WORD. It finishes UNBOX, a word nobody owns, and 2 more.");
    expect(n.note.notificationId).toBe("deal-x-unbox-20783");
    expect(n.facts).toEqual([["Letter", "x"], ["From", "9.80M $WORD"], ["Finishes", "UNBOX"]]);
    expect(dealNote(A, { ...pick, letter: "q", word: "QUICK", more: 0 }, 20783).note.body).toBe("A q is for sale on the Market, from 9.80M $WORD. It finishes QUICK, a word nobody owns.");
  });
});

describe("dealNotes: once a day at most, and the same letter and word once a week", () => {
  const DAY = 20783;
  /**
   * The mark store as the database keeps it (lib/db/reminderMarks `claimMarkEvery`): a mark is
   * taken again only once it is DEAL_AGAIN_SECONDS old. `clock.day` is today.
   */
  function deps(over: Partial<DealDeps> = {}) {
    const marks = new Map<string, number>();
    const clock = { day: DAY };
    const d: DealDeps = {
      accounts: [A],
      walletsOf: (account) => (account === A ? [A, A2] : [account]),
      accountOf: (address) => (address.toLowerCase() === A2 ? A : address.toLowerCase()),
      lettersOf: async () => ({ [A]: bag("unbo"), [A2]: bag("") }),
      unclaimed,
      book: book(ask(id("x"), 9_800_000)),
      claim: async (account, mark) => {
        const key = `${account}|${mark}`;
        const at = marks.get(key);
        if (at !== undefined && (clock.day - at) * 86_400 < DEAL_AGAIN_SECONDS) return "taken";
        marks.set(key, clock.day);
        return "claimed";
      },
      ...over,
    };
    return { d, marks, clock };
  }
  const told = async (d: DealDeps, day: number) => (await dealNotes(d, day)).map((n) => n.note.notificationId);

  it("tells an opted-in player of their best deal", async () => {
    const { d, marks } = deps();
    const notes = await dealNotes(d, DAY);
    expect(notes.map((n) => [n.account, n.wallet, n.note.notificationId])).toEqual([[A, A, `deal-x-unbox-${DAY}`]]);
    expect([...marks.keys()]).toEqual([`${A}|${dealMark({ letter: "x", word: "UNBOX" })}`]);
  });

  it("doesn’t say the same deal again within a week, whichever weekday it began on, and says it again after", async () => {
    const { d, clock } = deps();
    expect(await told(d, clock.day)).toHaveLength(1);
    for (let i = 1; i <= 6; i++) {
      clock.day = DAY + i;
      expect(await told(d, clock.day)).toEqual([]);
    }
    clock.day = DAY + 7;
    expect(await told(d, clock.day)).toEqual([`deal-x-unbox-${DAY + 7}`]);
  });

  it("a deal already told doesn’t hide a new one: the next best is today’s", async () => {
    // a wallet one letter short of UNBOX (x) and of other words (through the other letters for sale)
    const many = { lettersOf: async () => ({ [A]: bag("unboaeilrst"), [A2]: bag("") }), book: book(...[..."xqzkjvwdmpy"].map((ch, i) => ask(id(ch), (i + 1) * 1_000_000))) };
    const { d, clock } = deps(many);
    const first = await told(d, clock.day);
    clock.day = DAY + 1;
    const second = await told(d, clock.day);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // another letter and word, never yesterday's again
    expect(String(second[0]).replace(/-\d+$/, "")).not.toBe(String(first[0]).replace(/-\d+$/, ""));
  });

  it("is one alert a day at most, however many deals there are", async () => {
    const { d } = deps({ lettersOf: async () => ({ [A]: bag("unboaeilrst"), [A2]: bag("") }), book: book(...[..."xqzkjvwdmpy"].map((ch, i) => ask(id(ch), (i + 1) * 1_000_000))) });
    expect(await dealNotes(d, DAY)).toHaveLength(1);
  });

  it("sends nothing while the throttle can’t be kept (the migration hasn’t run)", async () => {
    const { d } = deps({ claim: async () => "unavailable" });
    expect(await dealNotes(d, DAY)).toEqual([]);
  });

  it("a dry run picks without using up the player’s alert", async () => {
    const { d, marks } = deps();
    expect(await dealNotes(d, DAY, { dry: true })).toHaveLength(1);
    expect(marks.size).toBe(0);
  });

  it("asks nothing of the chain when nobody opted in", async () => {
    let asked = false;
    const { d } = deps({ accounts: [], lettersOf: async () => ((asked = true), {}) });
    expect(await dealNotes(d, DAY)).toEqual([]);
    expect(asked).toBe(false);
  });
});
