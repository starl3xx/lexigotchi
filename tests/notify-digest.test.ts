/**
 * The weekly email digest (lib/notify/digest.ts; decisions.md #47, part 5): one email a week in
 * place of the ones that can come every day, for a player who chose it.
 */
import { describe, it, expect } from "vitest";
import { sendDigests, weekEarned, weekSold, wordsNeedingCare, type DigestDeps } from "@/lib/notify/digest";
import { weeklyDigest, type WeekFacts } from "@/lib/notify/templates";

const A = "0x00000000000000000000000000000000000000aa";
const A2 = "0x00000000000000000000000000000000000000a2";
const B = "0x00000000000000000000000000000000000000bb";
const WEI = 10n ** 18n;
const PERIOD = 2968; // days 20776 to 20782
const DAY1 = PERIOD * 7;
const week = (over: Partial<WeekFacts> = {}): WeekFacts => ({ earned: 84_000, sold: { count: 2, amount: 3_400_000 }, hungry: [], peckish: [], ...over });

describe("weekEarned", () => {
  const share = (stream: "yield" | "bounty", epochId: number, whole: bigint, over: { paid?: boolean; dead?: boolean } = {}) => ({ stream, epochId: String(epochId), amount: String(whole * WEI), paid: true, ...over });
  it("adds the week’s days and the week’s own bounty", () => {
    const shares = [
      share("yield", DAY1, 10_000n),
      share("yield", DAY1 + 6, 20_000n),
      share("bounty", PERIOD, 5_000n),
      share("yield", DAY1 + 7, 99_000n), // next week's first day
      share("yield", DAY1 - 1, 99_000n), // the week before
      share("bounty", PERIOD - 1, 99_000n),
    ];
    expect(weekEarned(shares, PERIOD, 7)).toBe(35_000);
    expect(weekEarned([], PERIOD, 7)).toBe(0);
  });

  it("counts a share the payout hasn’t reached yet, as the Earnings sheet does, and never a dead one", () => {
    const shares = [
      share("yield", DAY1, 10_000n),
      share("bounty", PERIOD, 5_000n, { paid: false }), // opened today, the payout ran out of time
      share("yield", DAY1 + 2, 99_000n, { paid: false, dead: true }), // its epoch has nothing left
    ];
    expect(weekEarned(shares, PERIOD, 7)).toBe(15_000);
  });
});

describe("weekSold", () => {
  const accountOf = (address: string) => (address.toLowerCase() === A2 ? A : address.toLowerCase());
  const row = (buyer: string, whole: bigint) => ({ buyer, priceWei: String(whole * WEI) });
  it("counts what other players bought, and what they paid", () => {
    expect(weekSold([row(B, 1_000_000n), row(B, 2_400_000n)], A, accountOf)).toEqual({ count: 2, amount: 3_400_000 });
    expect(weekSold([], A, accountOf)).toEqual({ count: 0, amount: 0 });
  });

  it("a fill bought by the player’s own other wallet is a move, not a sale", () => {
    expect(weekSold([row(A2, 9_000_000n), row(B, 1_000_000n)], A, accountOf)).toEqual({ count: 1, amount: 1_000_000 });
    expect(weekSold([row(A2.toUpperCase().replace("0X", "0x"), 9_000_000n)], A, accountOf)).toEqual({ count: 0, amount: 0 });
  });
});

describe("wordsNeedingCare", () => {
  const D = 86_400;
  const w = (word: string, owner: string, secondsUnfed: number, staked = true) => ({ word, owner, staked, secondsUnfed });
  it("lists the player’s staked words that are hungry and peckish now, the longest unfed first", () => {
    const words = [w("CRANE", A, 4 * D), w("TEASE", A2, 3 * D), w("VIVID", A, 2 * D), w("MOTEL", A, 0), w("JAZZY", B, 9 * D), w("QUILT", A, 9 * D, false)];
    expect(wordsNeedingCare(words, [A, A2], { peckishAfterDays: 1, hungryAfterDays: 3 })).toEqual({ hungry: ["CRANE", "TEASE"], peckish: ["VIVID"] });
  });
});

describe("weeklyDigest", () => {
  it("leads with a word that needs care, then the week", () => {
    const d = weeklyDigest(week({ hungry: ["CRANE", "TEASE"], peckish: ["VIVID"] }), PERIOD)!;
    expect(d.note.title).toBe("Your week in Lexigotchi");
    expect(d.note.body).toMatch(/^CRANE and 1 more are hungry: a hungry word earns nothing and sits out the jackpot until it’s fed\./);
    expect(d.facts).toEqual([
      ["Hungry now", "CRANE and 1 more"],
      ["Peckish now", "VIVID"],
      ["Your words earned", "84.0K $WORD"],
      ["2 sales on the Market", "3.40M $WORD"],
    ]);
    expect(d.note.notificationId).toBe(`week-${PERIOD}`);
  });

  it("says only what happened", () => {
    expect(weeklyDigest(week({ earned: 0 }), PERIOD)!.facts).toEqual([["2 sales on the Market", "3.40M $WORD"]]);
    expect(weeklyDigest(week({ sold: { count: 0, amount: 0 } }), PERIOD)!.note.body).toBe("Here is how your words did this week.");
  });

  it("counts one sale as one", () => {
    expect(weeklyDigest(week({ earned: 0, sold: { count: 1, amount: 900_000 } }), PERIOD)!.facts).toEqual([["1 sale on the Market", "900.0K $WORD"]]);
  });

  it("is nothing at all for a week with nothing in it", () => {
    expect(weeklyDigest(week({ earned: 0, sold: { count: 0, amount: 0 } }), PERIOD)).toBeNull();
  });
});

describe("sendDigests", () => {
  function deps(over: Partial<DigestDeps> = {}) {
    const sent: { to: string; account: string; facts: [string, string][]; id: string }[] = [];
    const marks = new Set<string>();
    const d: DigestDeps = {
      accounts: [A, B],
      walletsOf: (account) => (account === A ? [A, A2] : [account]),
      recipients: async (accounts) => accounts.filter((a) => a === A).map((a) => ({ address: a, email: "a@example.test" })),
      weekOf: async () => week(),
      claim: async (account, mark) => (marks.has(`${account}|${mark}`) ? "taken" : (marks.add(`${account}|${mark}`), "claimed")),
      release: async (account, mark) => void marks.delete(`${account}|${mark}`),
      send: async (to, account, _note, facts, id) => (sent.push({ to, account, facts, id }), true),
      ...over,
    };
    return { d, sent, marks };
  }

  it("emails a player who chose it and keeps email on: the unsubscribed get nothing", async () => {
    const { d, sent } = deps(); // B chose the digest, then turned email off (not among the recipients)
    expect(await sendDigests(d, PERIOD)).toEqual({ sent: 1, empty: 0, skipped: 0 });
    expect(sent.map((s) => [s.to, s.account])).toEqual([["a@example.test", A]]);
    expect(sent[0].id).toBe(`digest-${A}-week-${PERIOD}`);
  });

  it("sends a week once", async () => {
    const { d, sent } = deps();
    await sendDigests(d, PERIOD);
    expect(await sendDigests(d, PERIOD)).toEqual({ sent: 0, empty: 0, skipped: 1 });
    expect(sent).toHaveLength(1);
    // the next week is another email
    expect((await sendDigests(d, PERIOD + 1)).sent).toBe(1);
  });

  it("sends nothing for an empty week, and takes no mark for it", async () => {
    const { d, sent, marks } = deps({ weekOf: async () => week({ earned: 0, sold: { count: 0, amount: 0 } }) });
    expect(await sendDigests(d, PERIOD)).toEqual({ sent: 0, empty: 1, skipped: 0 });
    expect(sent).toEqual([]);
    expect(marks.size).toBe(0);
  });

  it("gives the mark back when the send fails, and sends nothing while a mark can’t be kept", async () => {
    const failing = deps({ send: async () => false });
    await sendDigests(failing.d, PERIOD);
    expect(failing.marks.size).toBe(0);
    const noTable = deps({ claim: async () => "unavailable" });
    expect(await sendDigests(noTable.d, PERIOD)).toEqual({ sent: 0, empty: 0, skipped: 1 });
    expect(noTable.sent).toEqual([]);
  });

  it("a dry run reads and reports, and neither marks nor sends", async () => {
    const { d, sent, marks } = deps();
    const lines: string[] = [];
    await sendDigests(d, PERIOD, { dry: true, log: (l) => lines.push(l) });
    expect(sent).toEqual([]);
    expect(marks.size).toBe(0);
    expect(lines.join("\n")).toMatch(/\[dry\] would email .*Your words earned 84\.0K \$WORD/);
  });

  it("one player’s failed read doesn’t stop the next player’s digest", async () => {
    const { d, sent } = deps({
      accounts: [B, A],
      recipients: async (accounts) => accounts.map((a) => ({ address: a, email: `${a.slice(-2)}@example.test` })),
      weekOf: async (account) => {
        if (account === B) throw new Error("the RPC is down");
        return week();
      },
    });
    expect((await sendDigests(d, PERIOD)).sent).toBe(1);
    expect(sent[0].account).toBe(A);
  });
});
