/**
 * The deal alert (lib/notify/deals.ts; decisions.md #47, part 4): "A q is for sale on the Market.
 * It finishes QUICK, a word nobody owns." It must be TRUE when it arrives, and it must not nag.
 */
import { describe, it, expect } from "vitest";
import { DEAL_AGAIN_SECONDS, DEAL_DAILY_SECONDS, bestDeal, dealMark, dealNote, dealNotes, rankedDeals, tellDeals, type DealDeps } from "@/lib/notify/deals";
import { emailNotes, pushNotes, type PlayerNote } from "@/lib/notify/players";
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
  const MANY = { lettersOf: async () => ({ [A]: bag("unboaeilrst"), [A2]: bag("") }), book: book(...[..."xqzkjvwdmpy"].map((ch, i) => ask(id(ch), (i + 1) * 1_000_000))) };
  /**
   * The mark store as the database keeps it (lib/db/reminderMarks `claimMarkEvery`): a mark is
   * taken again only once it is old enough. `clock.day` is today, in days (it may be a fraction).
   */
  function deps(over: Partial<DealDeps> = {}) {
    const marks = new Map<string, number>();
    const clock = { day: DAY };
    const every = (key: string, seconds: number) => {
      const at = marks.get(key);
      if (at !== undefined && (clock.day - at) * 86_400 < seconds) return "taken" as const;
      marks.set(key, clock.day);
      return "claimed" as const;
    };
    const d: DealDeps = {
      accounts: [A],
      walletsOf: (account) => (account === A ? [A, A2] : [account]),
      accountOf: (address) => (address.toLowerCase() === A2 ? A : address.toLowerCase()),
      lettersOf: async () => ({ [A]: bag("unbo"), [A2]: bag("") }),
      unclaimed,
      book: book(ask(id("x"), 9_800_000)),
      marks: {
        claimDay: async (account) => every(`${account}|day`, DEAL_DAILY_SECONDS),
        releaseDay: async (account) => void marks.delete(`${account}|day`),
        claimDeal: async (account, mark) => every(`${account}|${mark}`, DEAL_AGAIN_SECONDS),
        releaseDeal: async (account, mark) => void marks.delete(`${account}|${mark}`),
      },
      ...over,
    };
    return { d, marks, clock };
  }
  const told = async (d: DealDeps, day: number) => (await dealNotes(d, day)).map((n) => n.note.notificationId);
  /** Send to everyone (the alert reached them), or to nobody. */
  const everyone = async (notes: readonly PlayerNote[]) => new Set(notes.map((n) => n.account));
  const nobody = async () => new Set<string>();

  it("tells an opted-in player of their best deal, and holds both marks", async () => {
    const { d, marks } = deps();
    const notes = await dealNotes(d, DAY);
    expect(notes.map((n) => [n.account, n.wallet, n.note.notificationId, n.mark])).toEqual([[A, A, `deal-x-unbox-${DAY}`, dealMark({ letter: "x", word: "UNBOX" })]]);
    expect([...marks.keys()].sort()).toEqual([`${A}|day`, `${A}|${dealMark({ letter: "x", word: "UNBOX" })}`].sort());
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

  it("a day with only deals already told doesn’t use up the day", async () => {
    const { d, marks, clock } = deps();
    await dealNotes(d, clock.day);
    clock.day = DAY + 1;
    expect(await told(d, clock.day)).toEqual([]);
    // today's mark was given back, so a deal that appears later today can still be told
    expect(marks.has(`${A}|day`)).toBe(false);
  });

  it("a deal already told doesn’t hide a new one: the next best is tomorrow’s", async () => {
    const { d, clock } = deps(MANY);
    const first = await told(d, clock.day);
    clock.day = DAY + 1;
    const second = await told(d, clock.day);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // another letter and word, never yesterday's again
    expect(String(second[0]).replace(/-\d+$/, "")).not.toBe(String(first[0]).replace(/-\d+$/, ""));
  });

  it("is one alert a day, across keeper runs too: a second run the same day sends nothing", async () => {
    const { d, clock } = deps(MANY);
    expect(await dealNotes(d, clock.day)).toHaveLength(1);
    // a rerun an hour later, with ten more deals waiting
    clock.day = DAY + 1 / 24;
    expect(await dealNotes(d, DAY)).toEqual([]);
    // tomorrow's run, a day after the first
    clock.day = DAY + 1;
    expect(await dealNotes(d, DAY + 1)).toHaveLength(1);
  });

  it("sends nothing while the marks can’t be kept (the migration hasn’t run)", async () => {
    const { d } = deps();
    d.marks.claimDay = async () => "unavailable";
    expect(await dealNotes(d, DAY)).toEqual([]);
    const half = deps();
    half.d.marks.claimDeal = async () => "unavailable";
    expect(await dealNotes(half.d, DAY)).toEqual([]);
    expect(half.marks.size).toBe(0); // the day's mark went back
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

  describe("tellDeals: a mark stands only for an alert that went out", () => {
    it("keeps the marks of a player the alert reached", async () => {
      const { d, marks } = deps();
      expect(await tellDeals({ ...d, tell: everyone }, DAY)).toMatchObject({ told: 1 });
      expect(marks.size).toBe(2);
      // so a second run the same day, and the same deal tomorrow, say nothing
      expect((await tellDeals({ ...d, tell: everyone }, DAY)).notes).toEqual([]);
    });

    it("gives both marks back when the alert reached nobody, and the next run tells the same deal", async () => {
      const { d, marks } = deps();
      // no channel reaches the player, the send failed, or the choices couldn't be read
      expect(await tellDeals({ ...d, tell: nobody }, DAY)).toMatchObject({ told: 0 });
      expect(marks.size).toBe(0);
      const again = await tellDeals({ ...d, tell: everyone }, DAY);
      expect(again.notes.map((n) => n.note.notificationId)).toEqual([`deal-x-unbox-${DAY}`]);
      expect(again.told).toBe(1);
    });

    it("gives the marks back when the sender throws", async () => {
      const { d, marks } = deps();
      const res = await tellDeals({ ...d, tell: async () => { throw new Error("the sender is down"); } }, DAY);
      expect(res.told).toBe(0);
      expect(marks.size).toBe(0);
    });

    it("settles each player by themselves", async () => {
      const B = "0x00000000000000000000000000000000000000bb";
      const { d, marks } = deps({ accounts: [A, B], lettersOf: async () => ({ [A]: bag("unbo"), [A2]: bag(""), [B]: bag("unbo") }) });
      const res = await tellDeals({ ...d, tell: async () => new Set([B]) }, DAY);
      expect(res).toMatchObject({ told: 1 });
      expect([...marks.keys()].every((k) => k.startsWith(B))).toBe(true);
      expect(marks.size).toBe(2);
    });

    it("a dry run tells nobody and marks nothing", async () => {
      const { d, marks } = deps();
      let sent = false;
      const res = await tellDeals({ ...d, tell: async () => ((sent = true), new Set<string>()) }, DAY, { dry: true });
      expect(res.notes).toHaveLength(1);
      expect(sent).toBe(false);
      expect(marks.size).toBe(0);
    });
  });
});

describe("the shared sender says whom it reached (lib/notify/players.ts)", () => {
  const note = (account: string): PlayerNote => ({ account, wallet: account, note: { title: "t", body: "b", notificationId: "n-1" } });
  const B = "0x00000000000000000000000000000000000000bb";
  const C = "0x00000000000000000000000000000000000000cc";

  it("a push that went out counts; a failed push and a player with no channel don’t", async () => {
    const reached: string[] = [];
    await pushNotes([note(A), note(B), note(C)], {
      accountOf: (a) => a,
      fidOf: (w) => (w === A ? 77 : w === B ? 78 : undefined), // C has neither Farcaster nor a browser
      subs: [],
      toFarcaster: async (fid) => ({ ok: fid === 77 }),
      toBrowsers: async () => ({ ok: true }),
      onReached: (a) => reached.push(a),
    });
    expect(reached).toEqual([A]);
  });

  it("an email that went out counts; one the mail service refused doesn’t", async () => {
    const reached: string[] = [];
    await emailNotes([note(A), note(B)], {
      recipients: async (accounts) => accounts.map((a) => ({ address: a, email: `${a.slice(-2)}@example.test` })),
      claim: async () => "claimed",
      release: async () => {},
      send: async (_to, account) => account === B,
      onReached: (a) => reached.push(a),
    });
    expect(reached).toEqual([B]);
  });
});
