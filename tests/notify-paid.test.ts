/**
 * Payday and the bounty result (lib/notify/paid.ts; decisions.md #47, part 3): what the keeper's
 * payout tells players. The rule that matters: a message says "paid" only for what LANDED, per
 * player, and payday goes only to a player who turned it on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bountyNotes, paydayNotes, type LandedShare } from "@/lib/notify/paid";
import { linkMapFrom } from "@/lib/db/walletLinks";
import { prefsBookFrom } from "@/lib/db/reminderPrefs";

const A = "0x00000000000000000000000000000000000000aa";
const A2 = "0x00000000000000000000000000000000000000a2"; // linked into A's account
const B = "0x00000000000000000000000000000000000000bb";
const accountOf = (a: string) => (a.toLowerCase() === A2 ? A : a.toLowerCase());
const WEI = 10n ** 18n;
const DAY = 20_783;
const share = (over: Partial<LandedShare> = {}): LandedShare => ({ stream: "yield", epochId: DAY, account: A, amount: 42_000n * WEI, ...over });

describe("paydayNotes", () => {
  it("adds up what a player’s wallets were paid: linked wallets are one player, one message", () => {
    const notes = paydayNotes([share(), share({ account: A2, amount: 8_000n * WEI }), share({ account: B, amount: 1_000n * WEI })], accountOf);
    expect(notes.map((n) => [n.account, n.note.body])).toEqual([
      [A, "Your words earned 50.0K $WORD. It’s paid, straight to the wallets that hold them."],
      [B, "Your words earned 1.0K $WORD. It’s paid, straight to the wallets that hold them."],
    ]);
    expect(notes[0].facts).toEqual([["Earned", "50.0K $WORD"]]);
  });

  it("is one message for the newest day, also when the run paid an earlier day’s leftovers", () => {
    const [n] = paydayNotes([share({ epochId: DAY - 1 }), share({ epochId: DAY })], accountOf);
    expect(n.note.notificationId).toBe(`paid-${DAY}`);
    expect(n.note.body).toContain("84.0K $WORD");
    expect(n.note.body).not.toMatch(/today/); // a leftover wasn't today's
  });

  it("rounds down to whole $WORD, and says nothing of less than one", () => {
    expect(paydayNotes([share({ amount: 2n * WEI - 1n })], accountOf)[0].note.body).toContain("earned 1 $WORD");
    expect(paydayNotes([share({ amount: WEI - 1n })], accountOf)).toEqual([]);
  });

  it("leaves bounty shares to the bounty’s message, and nothing landed is nothing said", () => {
    expect(paydayNotes([share({ stream: "bounty" })], accountOf)).toEqual([]);
    expect(paydayNotes([], accountOf)).toEqual([]);
  });
});

describe("bountyNotes", () => {
  it("tells a player of their words’ SHARE of a week, with the week’s theme", () => {
    // period 2968 → theme 2968 % 5 = 3: "Starts with a vowel"
    const [n] = bountyNotes([share({ stream: "bounty", epochId: 2968, amount: 30_000n * WEI }), share({ stream: "bounty", epochId: 2968, account: A2, amount: 45_000n * WEI })], accountOf);
    expect(n.account).toBe(A);
    expect(n.note.body).toBe("Your words fit the week’s theme, vowel-start. Their share of the bounty is 75.0K $WORD, and it’s in your wallet.");
    expect(n.note.notificationId).toBe("bounty-2968");
    expect(n.facts).toEqual([["Theme", "Starts with a vowel"], ["Your words’ share", "75.0K $WORD"]]);
    expect(n.note.title).not.toMatch(/^The bounty is yours/); // it is shared
  });

  it("is one message per week: two weeks paid in one run are two", () => {
    const notes = bountyNotes([share({ stream: "bounty", epochId: 2967 }), share({ stream: "bounty", epochId: 2968 })], accountOf);
    expect(notes.map((n) => n.note.notificationId).sort()).toEqual(["bounty-2967", "bounty-2968"]);
  });

  it("leaves the daily earnings to payday", () => {
    expect(bountyNotes([share()], accountOf)).toEqual([]);
  });
});

describe("notifyPaid, through the shared sender", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, { NODE_ENV: "production", NOTIFICATIONS_ENABLED: "true" });
  });
  afterEach(() => {
    process.env = { ...env };
    for (const m of ["@/lib/notify/email", "@/lib/db/walletLinks", "@/lib/db/queries", "@/lib/neynar", "@/lib/db/webPush", "@/lib/db/reminderPrefs", "@/lib/notify/send"]) vi.doUnmock(m);
  });
  function mockWorld(prefs: ReturnType<typeof prefsBookFrom>) {
    const sent: { fid: number; id?: string }[] = [];
    vi.doMock("@/lib/notify/email", () => ({ emailEnabled: () => false }));
    vi.doMock("@/lib/db/walletLinks", () => ({ loadLinkMap: async () => linkMapFrom([{ address: A2, account: A }]) }));
    vi.doMock("@/lib/db/queries", () => ({ notifiableFids: async () => [77, 78] }));
    vi.doMock("@/lib/neynar", () => ({ fidsByAddresses: async (ws: string[]) => new Map(ws.map((w) => [w, w === A || w === A2 ? [77] : [78]])) }));
    vi.doMock("@/lib/db/webPush", () => ({ allWebPushSubscriptions: async () => [] }));
    vi.doMock("@/lib/db/reminderPrefs", () => ({ loadPrefs: async () => prefs }));
    vi.doMock("@/lib/notify/send", () => ({ sendNotification: async (n: { targetFids: number[]; notificationId?: string }) => (sent.push({ fid: n.targetFids[0], id: n.notificationId }), { ok: true }) }));
    return sent;
  }
  const landed = [share(), share({ account: B }), share({ stream: "bounty", epochId: 2968, account: B, amount: 9_000n * WEI })];

  it("payday reaches only a player who turned it ON; the bounty reaches everyone it paid", async () => {
    const sent = mockWorld(prefsBookFrom([{ account: A, kinds: { payday: true } }]));
    const { notifyPaid } = await import("@/lib/notify/paid");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await notifyPaid(landed);
    quiet.mockRestore();
    expect(sent).toEqual([{ fid: 77, id: `paid-${DAY}` }, { fid: 78, id: "bounty-2968" }]);
    expect(res.payday?.farcaster).toBe(1);
    expect(res.bounty?.farcaster).toBe(1);
  });

  it("a player who turned the bounty off isn’t told of it", async () => {
    const sent = mockWorld(prefsBookFrom([{ account: B, kinds: { bounty: false } }]));
    const { notifyPaid } = await import("@/lib/notify/paid");
    expect((await notifyPaid(landed)).bounty).toBeNull();
    expect(sent).toEqual([]);
  });

  it("says nothing when the choices can’t be read, or when nothing landed", async () => {
    const sent = mockWorld(prefsBookFrom([], false));
    const { notifyPaid } = await import("@/lib/notify/paid");
    expect(await notifyPaid(landed)).toEqual({ payday: null, bounty: null });
    expect(await notifyPaid([])).toEqual({ payday: null, bounty: null });
    expect(sent).toEqual([]);
  });
});
