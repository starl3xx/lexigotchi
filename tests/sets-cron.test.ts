/**
 * GET /api/cron/sets (hourly): reveals what is due, marks releases, and tells players of a set's
 * moments once. Pinned here: who may call it, that a muted switch sends nothing, and that nothing
 * is sent when there is nothing to say. lib/notify/sets.ts has the rest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WordSet } from "@/lib/sets/rules";

const world = vi.hoisted(() => ({ sets: [] as WordSet[], migrated: true, claimed: [] as string[], sent: 0 }));

vi.mock("@/lib/sets/server", () => ({
  loadSets: async () => ({ sets: world.sets, migrated: world.migrated, known: true }),
  reconcile: async () => [],
}));
vi.mock("@/lib/db/reminderMarks", () => ({
  claimMark: async (_a: string, _k: string, mark: string) => (world.claimed.includes(mark) ? "taken" : (world.claimed.push(mark), "claimed")),
  releaseMark: async (_a: string, _k: string, mark: string) => void (world.claimed = world.claimed.filter((m) => m !== mark)),
}));
// Every channel stands in: what is pinned here is the route's own decisions.
vi.mock("@/lib/db/queries", () => ({ notifiableFids: async () => [1, 2] }));
vi.mock("@/lib/notify/send", () => ({ sendNotification: async () => (world.sent++, { ok: true }) }));
vi.mock("@/lib/notify/webPush", () => ({ sendWebPush: async () => ({ ok: true, delivered: 0 }) }));
vi.mock("@/lib/db/webPush", () => ({ allWebPushSubscriptions: async () => [] }));
vi.mock("@/lib/db/profiles", () => ({ emailRecipients: async () => [], isMissingTable: () => false }));
vi.mock("@/lib/db/walletLinks", () => ({ loadLinkMap: async () => ({ accountOf: (a: string) => a.toLowerCase(), walletsOf: (a: string) => [a.toLowerCase()] }) }));
vi.mock("@/lib/db/reminderPrefs", () => ({ loadPrefs: async () => ({ known: true, wants: () => true, chose: () => [], emailsNow: () => true }) }));
vi.mock("@/lib/neynar", () => ({ fidsByAddressesDetailed: async () => ({ fids: new Map(), answered: true }) }));
vi.mock("@/lib/notify/email", () => ({ emailEnabled: () => false, reminderEmail: () => null, sendEmails: async () => ({ sent: 0, failed: 0 }) }));
vi.mock("@/lib/notify/telegram", () => ({ telegramRemindersOn: () => false, tellByTelegram: async () => null }));
vi.mock("@/lib/db/telegramLinks", () => ({ allTelegramLinks: async () => [] }));

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
    expect(first.body.told).toEqual([{ setId: 4, moment: "revealed", outcome: "sent", reached: 2 }]);
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
});
