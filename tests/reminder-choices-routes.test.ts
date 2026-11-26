/**
 * Reminder choices at the edges: the profile route that reads and saves them, and the senders that
 * must obey them (the daily-letter cron here; a sale's seller in tests/notify-sold.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { linkMapFrom } from "@/lib/db/walletLinks";
import { prefsBookFrom } from "@/lib/db/reminderPrefs";

const A = "0x00000000000000000000000000000000000000aa";
const A2 = "0x00000000000000000000000000000000000000a2"; // linked into A's account
const B = "0x00000000000000000000000000000000000000bb";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/ratelimit", () => ({ allow: async () => true }));
});
afterEach(() => {
  for (const m of [
    "@/lib/ratelimit", "@/lib/profile/session", "@/lib/profile/account", "@/lib/db/reminderPrefs", "@/lib/db/queries", "@/lib/db/webPush", "@/lib/db/profiles",
    "@/lib/db/walletLinks", "@/lib/onchain/dailyIdentity", "@/lib/notify/email", "@/lib/onchain/reads", "@/lib/onchain/addresses", "@/lib/db/freeClaims",
    "@/lib/onchain/freeLedger", "@/lib/neynar", "@/lib/notify/send", "@/lib/notify/webPush",
  ]) vi.doUnmock(m);
  vi.unstubAllEnvs();
});

describe("/api/profile/reminders", () => {
  function mockProfile(opts: { account?: string | null; stored?: Record<string, boolean>; missingTable?: boolean } = {}) {
    const stored = { ...(opts.stored ?? {}) };
    vi.doMock("@/lib/profile/session", () => ({ profilesEnabled: () => true }));
    vi.doMock("@/lib/profile/account", () => ({ sessionAccountOf: async () => (opts.account === undefined ? A : opts.account) }));
    vi.doMock("@/lib/db/reminderPrefs", () => ({
      prefsOf: async () => (opts.missingTable ? {} : stored),
      savePrefs: async (_account: string, changes: Record<string, boolean>) => {
        if (opts.missingTable) throw Object.assign(new Error("no table"), { code: "42P01" });
        Object.assign(stored, changes);
        return stored;
      },
    }));
    return stored;
  }
  const route = () => import("@/app/api/profile/reminders/route");
  const put = async (body: unknown) =>
    (await route()).PUT(new Request("https://lexigotchi.test/api/profile/reminders", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = async () => (await route()).GET(new Request("https://lexigotchi.test/api/profile/reminders"));

  it("needs the wallet’s session, to read and to change", async () => {
    mockProfile({ account: null });
    expect((await get()).status).toBe(401);
    expect((await put({ kinds: { daily: false } })).status).toBe(401);
  });

  it("answers every kind, on or off: the defaults for a player who changed nothing", async () => {
    mockProfile();
    expect(await (await get()).json()).toEqual({ ok: true, kinds: { hunger: true, daily: true, jackpot: true, sold: true } });
  });

  it("changes the kinds named, and leaves the rest", async () => {
    const stored = mockProfile({ stored: { sold: false } });
    expect(await (await put({ kinds: { daily: false } })).json()).toEqual({ ok: true, kinds: { hunger: true, daily: false, jackpot: true, sold: false } });
    expect(stored).toEqual({ sold: false, daily: false });
  });

  it("refuses a body that names no kind it knows, or a value that isn’t yes or no", async () => {
    mockProfile();
    for (const bad of [{}, { kinds: {} }, { kinds: { someday: true } }, { kinds: { daily: "off" } }, { kinds: ["daily"] }, null]) {
      expect((await put(bad)).status).toBe(400);
    }
  });

  it("before the migration: reads the defaults, and says a choice can’t be kept yet", async () => {
    mockProfile({ missingTable: true });
    expect((await (await get()).json()).kinds.daily).toBe(true);
    const res = await put({ kinds: { daily: false } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });
});

describe("the daily-letter reminder obeys the choices", () => {
  const sub = (address: string, endpoint: string) => ({ address, fid: null, endpoint, p256dh: "k", auth: "a" });
  function mockCron(prefs: ReturnType<typeof prefsBookFrom>) {
    const sent = { fids: [] as number[], browsers: [] as string[], emails: [] as string[] };
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.doMock("@/lib/db/reminderPrefs", () => ({ loadPrefs: async () => prefs }));
    vi.doMock("@/lib/db/queries", () => ({ notifiableFids: async () => [77, 78] }));
    vi.doMock("@/lib/db/webPush", () => ({ allWebPushSubscriptions: async () => [sub(A2, "https://push.example/a2"), sub(B, "https://push.example/b")] }));
    vi.doMock("@/lib/db/profiles", () => ({
      emailRecipients: async () => [
        { address: A, email: "a@example.test", emailDailyDay: null, emailHungerDay: null },
        { address: B, email: "b@example.test", emailDailyDay: null, emailHungerDay: null },
      ],
      markEmailSent: async () => {},
    }));
    vi.doMock("@/lib/db/walletLinks", () => ({ loadLinkMap: async () => linkMapFrom([{ address: A2, account: A }]) }));
    // each player has one key; every key last pulled yesterday, so everybody is due
    vi.doMock("@/lib/onchain/dailyIdentity", () => ({ relatedDailyKeysMany: async (xs: unknown[]) => xs.map((_, i) => [BigInt(1000 + i)]) }));
    vi.doMock("@/lib/onchain/addresses", () => ({ maybeAddressOf: () => "0x00000000000000000000000000000000000000f1" }));
    vi.doMock("@/lib/onchain/reads", () => ({
      readChainTime: async () => 500 * 86_400 + 60,
      getPublicClient: () => ({ multicall: async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => 500n) }), // day 499, stored as day + 1
    }));
    vi.doMock("@/lib/db/freeClaims", () => ({ countingDailyGrants: async () => [] }));
    vi.doMock("@/lib/onchain/freeLedger", () => ({ freeGrantStop: async () => null }));
    // A's account is Farcaster id 77 (through its linked wallet); B's is 78
    vi.doMock("@/lib/neynar", () => ({ fidsByAddresses: async (ws: string[]) => new Map(ws.filter((w) => w === A2).map((w) => [w, [77]])) }));
    vi.doMock("@/lib/notify/send", () => ({ sendNotification: async (n: { targetFids: number[] }) => (sent.fids.push(...n.targetFids), { ok: true }) }));
    vi.doMock("@/lib/notify/webPush", () => ({ sendWebPush: async (to: { endpoint: string }[]) => (sent.browsers.push(...to.map((t) => t.endpoint)), { ok: true }) }));
    vi.doMock("@/lib/notify/email", () => ({
      emailEnabled: () => true,
      reminderEmail: (to: string, address: string) => ({ to, address, subject: "s", html: "h", text: "t" }),
      sendEmails: async (ms: { to: string }[]) => (sent.emails.push(...ms.map((m) => m.to)), { sent: ms.length, failed: 0 }),
    }));
    return sent;
  }
  const run = async () => (await import("@/app/api/cron/notify-daily/route")).GET(new Request("https://lexigotchi.test/api/cron/notify-daily", { headers: { authorization: "Bearer s3cret" } }));

  it("reminds everybody who is due when nobody has changed anything", async () => {
    const sent = mockCron(prefsBookFrom([]));
    expect((await run()).status).toBe(200);
    expect(sent.fids.sort()).toEqual([77, 78]);
    expect(sent.browsers.sort()).toEqual(["https://push.example/a2", "https://push.example/b"]);
    expect(sent.emails.sort()).toEqual(["a@example.test", "b@example.test"]);
  });

  it("leaves out a player who turned it off, on every channel, whichever wallet each channel knows", async () => {
    const sent = mockCron(prefsBookFrom([{ account: A, kinds: { daily: false } }]));
    await run();
    expect(sent.fids).toEqual([78]); // 77 is A's account, found through its linked wallet
    expect(sent.browsers).toEqual(["https://push.example/b"]); // the browser subscribed on A2
    expect(sent.emails).toEqual(["b@example.test"]);
  });

  it("reminds nobody when the choices can’t be read", async () => {
    const sent = mockCron(prefsBookFrom([], false));
    const body = await (await run()).json();
    expect(body.skipped).toBe("choices_unreadable");
    expect(sent.fids.length + sent.browsers.length + sent.emails.length).toBe(0);
  });
});
