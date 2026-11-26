/**
 * Telling a seller that something sold (lib/notify/sold.ts): a receipt hung on the sales recorder.
 * The rules under test are the ones that would hurt if wrong: who is told, of what, how often, and
 * that the Market's public route can't be broken or slowed by it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SOLD_TELL_WINDOW_MS, emailSold, reachableFid, soldChannels, soldGroups, soldItem, tellSold, type SoldDeps, type SoldEmailDeps } from "@/lib/notify/sold";
import { linkMapFrom } from "@/lib/db/walletLinks";
import type { Notification } from "@/lib/notify/templates";
import type { SaleRow } from "@/lib/db/market";

const NOW = Date.UTC(2026, 10, 26, 12);
const A = "0x00000000000000000000000000000000000000aa";
const A2 = "0x00000000000000000000000000000000000000a2"; // linked into A's account
const B = "0x00000000000000000000000000000000000000bb";
const BUYER = "0x00000000000000000000000000000000000000cc";
const accountOf = (a: string) => (a.toLowerCase() === A2 ? A : a.toLowerCase());
const WEI = 10n ** 18n;

let n = 0;
const sale = (over: Partial<SaleRow> = {}): SaleRow => ({
  chainId: 84532, txHash: `0x${String(++n).padStart(64, "0")}`, logIndex: 3, blockNumber: 100 + n, soldAt: new Date(NOW - 60_000),
  kind: "letter", orderHash: `0x${"e".repeat(64)}`, seller: A, buyer: BUYER, word: null, tier: null, letterId: 22, qty: 1,
  priceWei: String(1_300_000n * WEI), feeWei: String(130_000n * WEI), ...over,
});

function deps(over: Partial<SoldDeps> = {}) {
  const sent = { farcaster: [] as { fid: number; note: Notification }[], browsers: [] as { to: string[]; note: Notification }[] };
  const d: SoldDeps = {
    accountOf,
    fidOf: () => undefined,
    subs: [],
    toFarcaster: async (fid, note) => (sent.farcaster.push({ fid, note }), { ok: true }),
    toBrowsers: async (to, note) => (sent.browsers.push({ to: to.map((s) => s.endpoint), note }), { ok: true }),
    ...over,
  };
  return { d, sent };
}
const browser = (address: string, endpoint: string) => ({ address, fid: null, endpoint, p256dh: "k", auth: "a" });

describe("soldGroups", () => {
  it("groups a pass’s sales by the seller’s account, oldest first", () => {
    const rows = [sale({ seller: A2, kind: "word", word: "CRANE", letterId: null, soldAt: new Date(NOW - 30_000) }), sale({ seller: A }), sale({ seller: B })];
    const groups = soldGroups(rows, accountOf, NOW);
    expect(groups.map((g) => [g.account, g.items.map((i) => i.name)])).toEqual([[A, ["w", "CRANE"]], [B, ["w"]]]);
  });

  it("leaves out a sale that is history: a backfill tells nobody", () => {
    const old = sale({ soldAt: new Date(NOW - SOLD_TELL_WINDOW_MS - 1) });
    const edge = sale({ seller: B, soldAt: new Date(NOW - SOLD_TELL_WINDOW_MS) });
    expect(soldGroups([old, edge], accountOf, NOW).map((g) => g.account)).toEqual([B]);
    // a year of sales read at once (a new deployment's first catch-up), the newest two days old
    const year = Array.from({ length: 300 }, (_, i) => sale({ soldAt: new Date(NOW - (i + 2) * 86_400_000) }));
    expect(soldGroups(year, accountOf, NOW)).toEqual([]);
  });

  it("still tells of a sale only the daily keeper found: the window is wider than a day", () => {
    // sold 20 hours ago, on a day nobody opened the Market; the keeper's pass is the first to record it
    expect(SOLD_TELL_WINDOW_MS).toBeGreaterThan(24 * 3_600_000);
    expect(soldGroups([sale({ soldAt: new Date(NOW - 20 * 3_600_000) })], accountOf, NOW)).toHaveLength(1);
  });

  it("is no sale to tell of when the player moved it between their own wallets", () => {
    expect(soldGroups([sale({ seller: A, buyer: A2 })], accountOf, NOW)).toEqual([]);
  });

  it("reads a fill as the template wants it: the letter in its case, whole $WORD, its own identity", () => {
    expect(soldItem(sale({ letterId: 42, qty: 3, priceWei: String(3_900_000n * WEI + 5n), feeWei: String(390_000n * WEI), txHash: "0xabc", logIndex: 9 }))).toEqual({
      kind: "letter", name: "Q", qty: 3, amount: 3_900_000, share: 3_510_000, txHash: "0xabc", logIndex: 9,
    });
    expect(soldItem(sale({ kind: "word", word: "crane", letterId: null })).name).toBe("CRANE");
  });
});

describe("tellSold", () => {
  it("tells a seller Farcaster reaches there, and not in their browser too", async () => {
    const { d, sent } = deps({ fidOf: (a) => (a === A ? 77 : undefined), subs: [browser(A, "https://push.example/a")] });
    const res = await tellSold([sale()], d, { now: NOW });
    expect(sent.farcaster.map((s) => s.fid)).toEqual([77]);
    expect(sent.browsers).toEqual([]);
    expect(res).toEqual({ sellers: 1, farcaster: 1, browsers: 0, unreached: 0, emailed: 0 });
  });

  it("else tells every browser of the seller’s account, whichever wallet subscribed", async () => {
    const { d, sent } = deps({ subs: [browser(A2, "https://push.example/a2"), browser(B, "https://push.example/b")] });
    await tellSold([sale({ seller: A })], d, { now: NOW });
    expect(sent.browsers.map((s) => s.to)).toEqual([["https://push.example/a2"]]);
  });

  it("sends ONE message per seller for the sales handed over together, keyed on the first fill", async () => {
    const { d, sent } = deps({ fidOf: () => 77 });
    const first = sale({ txHash: `0x${"1".repeat(64)}`, logIndex: 4, soldAt: new Date(NOW - 50_000) });
    await tellSold([sale({ soldAt: new Date(NOW - 10_000) }), first, sale({ soldAt: new Date(NOW - 20_000) })], d, { now: NOW });
    expect(sent.farcaster).toHaveLength(1);
    expect(sent.farcaster[0].note.body).toMatch(/^3 of your listings sold, for 3\.90M \$WORD in all\./);
    expect(sent.farcaster[0].note.notificationId).toBe(`sold-${"1".repeat(32)}-4`);
  });

  it("a second part of the same listing, found by a later pass, is a second message with its own id", async () => {
    const { d, sent } = deps({ fidOf: () => 77 });
    const order = `0x${"9".repeat(64)}`;
    await tellSold([sale({ orderHash: order, txHash: `0x${"2".repeat(64)}`, logIndex: 4 })], d, { now: NOW });
    await tellSold([sale({ orderHash: order, txHash: `0x${"3".repeat(64)}`, logIndex: 4 })], d, { now: NOW });
    const ids = sent.farcaster.map((s) => s.note.notificationId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("tells no seller who turned “something of mine sold” off", async () => {
    const { d, sent } = deps({ fidOf: () => 77, wants: (account) => account !== A });
    const res = await tellSold([sale({ seller: A2 }), sale({ seller: B })], d, { now: NOW });
    expect(sent.farcaster).toHaveLength(1); // B only: A2 is A's account
    expect(res.sellers).toBe(1);
  });

  it("counts a seller no channel reaches, and sends nothing", async () => {
    const { d, sent } = deps();
    expect(await tellSold([sale()], d, { now: NOW })).toEqual({ sellers: 1, farcaster: 0, browsers: 0, unreached: 1, emailed: 0 });
    expect(sent.farcaster.length + sent.browsers.length).toBe(0);
  });

  it("one seller’s failed send doesn’t stop the next seller’s", async () => {
    const { d, sent } = deps({
      subs: [browser(A, "https://push.example/a"), browser(B, "https://push.example/b")],
      toBrowsers: async (to, note) => {
        if (to[0].endpoint.endsWith("/a")) throw new Error("push service down");
        sent.browsers.push({ to: to.map((s) => s.endpoint), note });
        return { ok: true };
      },
    });
    const res = await tellSold([sale({ seller: A }), sale({ seller: B })], d, { now: NOW });
    expect(res.browsers).toBe(1);
    expect(sent.browsers.map((s) => s.to)).toEqual([["https://push.example/b"]]);
  });
});

describe("emailSold", () => {
  function mail(over: Partial<SoldEmailDeps> = {}) {
    const sent: { to: string; account: string; title: string; facts: [string, string][]; id: string }[] = [];
    const marks = new Set<string>();
    const d: SoldEmailDeps = {
      accountOf,
      recipients: async (accounts) => accounts.filter((a) => a === A).map((a) => ({ address: a, email: "a@example.test" })),
      claim: async (account, mark) => (marks.has(`${account}:${mark}`) ? "taken" : (marks.add(`${account}:${mark}`), "claimed")),
      release: async (account, mark) => void marks.delete(`${account}:${mark}`),
      send: async (to, account, note, facts, id) => (sent.push({ to, account, title: note.title, facts, id }), true),
      ...over,
    };
    return { d, sent, marks };
  }

  it("emails a seller who has a confirmed address, with the sale as a ledger", async () => {
    const { d, sent } = mail();
    const res = await emailSold([sale({ seller: A2, kind: "word", word: "CRANE", letterId: null, priceWei: String(2_400_000n * WEI), feeWei: String(240_000n * WEI), txHash: `0x${"7".repeat(64)}`, logIndex: 2 })], d, { now: NOW });
    expect(res).toEqual({ sent: 1, skipped: 0 });
    expect(sent).toEqual([
      { to: "a@example.test", account: A, title: expect.any(String), facts: [["Sold", "CRANE"], ["For", "2.40M $WORD"], ["Your share", "2.16M $WORD"]], id: `sold-${"7".repeat(32)}-2` },
    ]);
  });

  it("emails nobody without an opted-in address: an unsubscribe stops this kind with the rest", async () => {
    // `recipients` is the profile's own list (confirmed address, email reminders on); B isn't on it
    const { d, sent } = mail();
    expect(await emailSold([sale({ seller: B })], d, { now: NOW })).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toEqual([]);
  });

  it("emails no seller who turned sales off", async () => {
    const { d, sent } = mail({ wants: () => false });
    await emailSold([sale()], d, { now: NOW });
    expect(sent).toEqual([]);
  });

  it("sends a sale once, however many passes hand it over", async () => {
    const { d, sent } = mail();
    const row = sale();
    await emailSold([row], d, { now: NOW });
    expect(await emailSold([row], d, { now: NOW })).toEqual({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(1);
  });

  it("gives the mark back when the send fails, so a later pass can still send it", async () => {
    let fail = true;
    const { d, sent, marks } = mail({ send: async (to, account, note, facts, id) => (fail ? false : (sent.push({ to, account, title: note.title, facts, id }), true)) });
    const row = sale();
    expect(await emailSold([row], d, { now: NOW })).toEqual({ sent: 0, skipped: 0 });
    expect(marks.size).toBe(0);
    fail = false;
    expect((await emailSold([row], d, { now: NOW })).sent).toBe(1);
  });

  it("sends nothing while the mark can’t be kept (the migration hasn’t run)", async () => {
    const { d, sent } = mail({ claim: async () => "unavailable" });
    expect(await emailSold([sale()], d, { now: NOW })).toEqual({ sent: 0, skipped: 1 });
    expect(sent).toEqual([]);
  });

  it("never emails about a sale that is history", async () => {
    const { d, sent } = mail();
    await emailSold([sale({ soldAt: new Date(NOW - SOLD_TELL_WINDOW_MS - 1) })], d, { now: NOW });
    expect(sent).toEqual([]);
  });
});

describe("reachableFid", () => {
  const links = linkMapFrom([{ address: A2, account: A }]);
  it("finds the Farcaster id of any wallet in the account, if that id added the app", () => {
    const fidOf = reachableFid(links, new Map([[A2, [77]]]), new Set([77]));
    expect(fidOf(A)).toBe(77); // A sold; the account's Farcaster wallet is A2
    expect(fidOf(A2)).toBe(77);
    expect(fidOf(B)).toBeUndefined();
  });
  it("skips an id that never added the app: it can’t be notified", () => {
    expect(reachableFid(links, new Map([[A, [5, 77]]]), new Set([77]))(A)).toBe(77);
    expect(reachableFid(links, new Map([[A, [5]]]), new Set([77]))(A)).toBeUndefined();
  });
});

describe("notifySold", () => {
  const env = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...env };
    vi.doUnmock("@/lib/db/walletLinks");
    vi.doUnmock("@/lib/notify/send");
  });

  it("reads which channels are armed without importing a sender", () => {
    expect(soldChannels({ NODE_ENV: "production", NOTIFICATIONS_ENABLED: "true", WEB_PUSH_ENABLED: "false" } as NodeJS.ProcessEnv)).toEqual({ farcaster: true, browser: false });
    // never outside production, whatever the flags say
    expect(soldChannels({ NODE_ENV: "test", NOTIFICATIONS_ENABLED: "true", WEB_PUSH_ENABLED: "true" } as NodeJS.ProcessEnv)).toEqual({ farcaster: false, browser: false });
  });

  it("with both channels dark, loads nothing and sends nothing", async () => {
    const loaded = vi.fn();
    vi.doMock("@/lib/db/walletLinks", () => (loaded(), { loadLinkMap: async () => ({ accountOf: (a: string) => a, walletsOf: () => [], size: 0 }) }));
    const { notifySold } = await import("@/lib/notify/sold");
    expect(await notifySold([sale({ soldAt: new Date() })])).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("an old sale is never worth loading an audience for", async () => {
    Object.assign(process.env, { NODE_ENV: "production", NOTIFICATIONS_ENABLED: "true" });
    const loaded = vi.fn();
    vi.doMock("@/lib/db/walletLinks", () => (loaded(), { loadLinkMap: async () => ({ accountOf: (a: string) => a, walletsOf: () => [], size: 0 }) }));
    const { notifySold } = await import("@/lib/notify/sold");
    expect(await notifySold([sale({ soldAt: new Date(Date.now() - SOLD_TELL_WINDOW_MS - 60_000) })])).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("never throws, whatever breaks under it", async () => {
    Object.assign(process.env, { NODE_ENV: "production", NOTIFICATIONS_ENABLED: "true" });
    vi.doMock("@/lib/db/walletLinks", () => ({
      loadLinkMap: async () => {
        throw new Error("database is down");
      },
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { notifySold } = await import("@/lib/notify/sold");
    await expect(notifySold([sale({ soldAt: new Date() })])).resolves.toBeNull();
    quiet.mockRestore();
  });
});
