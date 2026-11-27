/**
 * GET /api/cron/sets (hourly): reveals what is due, marks releases, and tells players of a set's
 * moments once. Pinned here: who may call it, that a muted switch sends nothing, and that nothing
 * is sent when there is nothing to say. lib/notify/sets.ts has the rest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WordSet } from "@/lib/sets/rules";

// Made-up players: ON keeps the kind on (Farcaster 1, a browser, an email, Telegram); OFF turned it
// off (Farcaster 2, a browser, an email, Telegram); WEB is a browser-only player with no Farcaster.
const ON = "0x00000000000000000000000000000000000000a1";
const OFF = "0x00000000000000000000000000000000000000b2";
const WEB = "0x00000000000000000000000000000000000000c3";

const world = vi.hoisted(() => ({
  sets: [] as WordSet[],
  migrated: true,
  claimed: [] as string[],
  sent: 0,
  prefsKnown: true,
  off: new Set<string>(),
  farcasterAnswers: true,
  email: false,
  telegram: false,
  seen: { fids: [] as number[][], browsers: [] as string[][], emails: [] as string[][], telegram: [] as string[][] },
}));

vi.mock("@/lib/sets/server", () => ({
  loadSets: async () => ({ sets: world.sets, migrated: world.migrated, known: true }),
  reconcile: async () => [],
}));
vi.mock("@/lib/db/reminderMarks", () => ({
  claimMark: async (_a: string, _k: string, mark: string) => (world.claimed.includes(mark) ? "taken" : (world.claimed.push(mark), "claimed")),
  releaseMark: async (_a: string, _k: string, mark: string) => void (world.claimed = world.claimed.filter((m) => m !== mark)),
}));
// Every channel stands in, and records whom it was asked to tell.
vi.mock("@/lib/db/queries", () => ({ notifiableFids: async () => [1, 2] }));
vi.mock("@/lib/notify/send", () => ({
  sendNotification: async ({ targetFids }: { targetFids: number[] }) => (world.sent++, world.seen.fids.push(targetFids), { ok: true }),
}));
vi.mock("@/lib/notify/webPush", () => ({
  sendWebPush: async (subs: { address: string }[]) => (world.seen.browsers.push(subs.map((x) => x.address)), { ok: true, delivered: subs.length }),
}));
vi.mock("@/lib/db/webPush", () => ({
  allWebPushSubscriptions: async () => [
    { address: "0x00000000000000000000000000000000000000a1", fid: 1, endpoint: "e1", p256dh: "k", auth: "a" },
    { address: "0x00000000000000000000000000000000000000b2", fid: 2, endpoint: "e2", p256dh: "k", auth: "a" },
    { address: "0x00000000000000000000000000000000000000c3", fid: null, endpoint: "e3", p256dh: "k", auth: "a" },
  ],
}));
vi.mock("@/lib/db/profiles", () => ({
  emailRecipients: async () => [
    { address: "0x00000000000000000000000000000000000000a1", email: "on@example.test", emailDailyDay: null, emailHungerDay: null },
    { address: "0x00000000000000000000000000000000000000b2", email: "off@example.test", emailDailyDay: null, emailHungerDay: null },
  ],
  isMissingTable: () => false,
}));
vi.mock("@/lib/db/walletLinks", () => ({ loadLinkMap: async () => ({ accountOf: (a: string) => a.toLowerCase(), walletsOf: (a: string) => [a.toLowerCase()] }) }));
vi.mock("@/lib/db/reminderPrefs", () => ({
  loadPrefs: async () => ({
    known: world.prefsKnown,
    wants: (account: string) => world.prefsKnown && !world.off.has(account.toLowerCase()),
    chose: (_k: string, on: boolean) => (world.prefsKnown && !on ? [...world.off] : []),
    emailsNow: () => world.prefsKnown,
  }),
}));
vi.mock("@/lib/neynar", () => ({
  // OFF's wallet is Farcaster's FID 2
  fidsByAddressesDetailed: async (addresses: string[]) => ({
    fids: new Map(world.farcasterAnswers ? addresses.filter((a) => a === "0x00000000000000000000000000000000000000b2").map((a) => [a, [2]]) : []),
    answered: world.farcasterAnswers,
  }),
}));
vi.mock("@/lib/notify/email", () => ({
  emailEnabled: () => world.email,
  reminderEmail: (to: string, address: string) => ({ to, address }),
  sendEmails: async (messages: { to: string }[]) => (world.seen.emails.push(messages.map((m) => m.to)), { sent: messages.length, failed: 0 }),
}));
vi.mock("@/lib/notify/telegram", () => ({
  telegramRemindersOn: () => world.telegram,
  tellByTelegram: async (_k: string, notes: { account: string }[]) => (world.seen.telegram.push(notes.map((n) => n.account)), { sent: notes.length, skipped: 0, failed: 0, dropped: 0, gone: 0 }),
}));
vi.mock("@/lib/db/telegramLinks", () => ({
  allTelegramLinks: async () => [
    { account: "0x00000000000000000000000000000000000000a1", telegramId: 1, name: "on" },
    { account: "0x00000000000000000000000000000000000000b2", telegramId: 2, name: "off" },
  ],
}));

const revealedNow = (id: number): WordSet => ({
  id, name: `Set ${id}`, status: "revealed", revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
  revealedAt: new Date(Date.now() - 60_000), releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
  words: [{ word: "CRANE", headliner: false }],
});

const call = async (auth?: string) => {
  const { GET } = await import("@/app/api/cron/sets/route");
  const res = await GET(new Request("http://localhost/api/cron/sets", { headers: auth ? { authorization: auth } : {} }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  world.sets = [];
  world.migrated = true;
  world.claimed = [];
  world.sent = 0;
  world.prefsKnown = true;
  world.off = new Set();
  world.farcasterAnswers = true;
  world.email = false;
  world.telegram = false;
  world.seen = { fids: [], browsers: [], emails: [], telegram: [] };
});

describe("GET /api/cron/sets", () => {
  it("is the scheduler's alone: the secret, or nothing in production", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("Bearer s3cret")).status).toBe(200);
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(401); // no secret set: closed, never open
    log.mockRestore();
  });

  it("says a set's moment once, however many times it runs", async () => {
    world.sets = [revealedNow(4)];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const first = await call();
    // Farcaster's two, and the one browser of a player Farcaster doesn't reach
    expect(first.body.told).toEqual([{ setId: 4, moment: "revealed", outcome: "sent", reached: 3 }]);
    const second = await call();
    expect(second.body.told).toEqual([{ setId: 4, moment: "revealed", outcome: "already", reached: 0 }]);
    expect(world.sent).toBe(1);
    // the run's log names sets by id only
    expect(JSON.stringify(log.mock.calls)).not.toContain("Set 4");
    log.mockRestore();
  });

  it("sends nothing while SET_REMINDERS is off, and takes no mark", async () => {
    vi.stubEnv("SET_REMINDERS", "off");
    world.sets = [revealedNow(4)];
    expect((await call()).body.told).toEqual([]);
    expect(world.sent).toBe(0);
    expect(world.claimed).toEqual([]);
  });

  it("does nothing before the tables exist, and nothing when there is nothing to say", async () => {
    world.migrated = false;
    expect(await call()).toEqual({ status: 200, body: { ok: true, sets: 0, released: [], told: [] } });
    world.migrated = true;
    world.sets = [{ ...revealedNow(5), status: "draft" }];
    expect((await call()).body.told).toEqual([]);
    expect(world.sent).toBe(0);
  });

  it("tells nobody when the choices can't be read, and gives the mark back for the next hour", async () => {
    world.sets = [revealedNow(4)];
    world.prefsKnown = false;
    world.email = true;
    world.telegram = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await call()).body.told).toEqual([{ setId: 4, moment: "revealed", outcome: "nobody", reached: 0 }]);
    expect(world.seen).toEqual({ fids: [], browsers: [], emails: [], telegram: [] });
    expect(world.claimed).toEqual([]); // not marked as said
    log.mockRestore();
  });

  it("a player who turned “A new set of words” off is in no channel; everyone else is", async () => {
    world.sets = [revealedNow(4)];
    world.off = new Set([OFF]);
    world.email = true;
    world.telegram = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await call();
    expect(world.seen.fids).toEqual([[1]]); // FID 2 is OFF's
    expect(world.seen.browsers).toEqual([[WEB]]); // ON's browser isn't told twice (Farcaster reached them); OFF's isn't told
    expect(world.seen.emails).toEqual([["on@example.test"]]);
    expect(world.seen.telegram).toEqual([[ON]]);
    log.mockRestore();
  });

  it("when Farcaster can't say who turned it off, nobody is told there, and the browsers still are", async () => {
    world.sets = [revealedNow(4)];
    world.off = new Set([OFF]);
    world.farcasterAnswers = false;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await call();
    expect(world.seen.fids).toEqual([]);
    expect(world.seen.browsers).toEqual([[ON, WEB]]); // nobody was reached by Farcaster, so ON's browser is told
    log.mockRestore();
  });
});

