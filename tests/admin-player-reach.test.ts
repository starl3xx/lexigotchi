import { describe, expect, it } from "vitest";
import { buildReachRows, hasAnything, reachSummary, type ReachInputs } from "@/lib/admin/playerReach";
import { buildPlayerRows, emptyActivity, groupPlayers } from "@/lib/admin/playerRows";
import { KIND_SHORT } from "@/lib/admin/kindLabels";
import { REMINDER_KINDS } from "@/lib/notify/kinds";

// Made-up wallets. A heads an account with A2 linked in; B plays alone; T is the team's.
const A = "0xaaaa000000000000000000000000000000000001";
const A2 = "0xaaaa000000000000000000000000000000000002";
const B = "0xbbbb000000000000000000000000000000000001";
const T = "0x7777000000000000000000000000000000000001";

type Player = ReachInputs["players"][number];
const player = (address: string, over: Partial<Player> = {}): Player => ({
  address,
  wallets: [{ address, lastSeen: null }],
  operator: false,
  lastSeen: "2026-11-27T10:00:00.000Z",
  name: null,
  pfpUrl: null,
  fids: [],
  ...over,
});

function inputs(over: Partial<ReachInputs> = {}): ReachInputs {
  return {
    players: [
      player(A, {
        name: "alice",
        lastSeen: "2026-11-27T12:00:00.000Z",
        wallets: [
          { address: A, lastSeen: "2026-11-26T10:00:00.000Z" },
          { address: A2, lastSeen: "2026-11-27T12:00:00.000Z" },
        ],
      }),
      player(B, { lastSeen: "2026-11-25T10:00:00.000Z" }),
      player(T, { operator: true }),
    ],
    profiles: [{ address: A, xUsername: "alice_x", emailConfirmed: true, emailReminders: true }],
    pushBrowsers: new Map([
      [A, 1],
      [A2, 2],
    ]),
    telegram: new Set([A]),
    prefs: [{ account: A, kinds: { daily: false, payday: true }, emailCadence: "weekly" }],
    farcaster: { fidsOf: new Map([[A2, [42]]]), answered: true },
    addedFids: new Set([42]),
    coinbase: new Map([
      [A, false],
      [A2, true],
      [B, false],
      [T, false],
    ]),
    ...over,
  };
}

const byAccount = (rows: ReturnType<typeof buildReachRows>, a: string) => rows.find((r) => r.account === a)!;

describe("buildReachRows: one row per player", () => {
  it("follows the players it's given, and sums across their wallets", () => {
    const rows = buildReachRows(inputs());
    expect(rows.map((r) => r.account)).toEqual([A, T, B]); // most recent first: A2 was seen last
    const a = byAccount(rows, A);
    expect(a.wallets).toEqual([A, A2]);
    expect(a.name).toBe("alice");
    expect(a.lastSeen).toBe("2026-11-27T12:00:00.000Z");
    expect(a.accounts).toEqual({ farcaster: [42], x: "alice_x", email: true, telegram: true, coinbase: true });
    expect(a.channels).toEqual({ farcasterApp: true, browsers: 3, email: true, telegram: true });
    expect(a.emailCadence).toBe("weekly");
    expect(a.changed).toEqual(["daily", "payday"]);
    expect(a.kinds).toMatchObject({ daily: false, payday: true, hunger: true, deal: false });
  });

  it("gives a player with nothing a row of plain noes, and the defaults", () => {
    const b = byAccount(buildReachRows(inputs()), B);
    expect(b.accounts).toEqual({ farcaster: [], x: false, email: false, telegram: false, coinbase: false });
    expect(b.channels).toEqual({ farcasterApp: false, browsers: 0, email: false, telegram: false });
    expect(b.emailCadence).toBe("each");
    expect(b.changed).toEqual([]);
    expect(hasAnything(b)).toBe(false);
  });

  it("reaches by Farcaster only through an id that added the mini app, as the sender does", () => {
    const a = byAccount(buildReachRows(inputs({ addedFids: new Set([7]) })), A);
    expect(a.accounts.farcaster).toEqual([42]);
    expect(a.channels.farcasterApp).toBe(false);
  });

  it("keeps a Farcaster id the game saw at a verified sign-in, though Neynar has none", () => {
    const rows = buildReachRows(inputs({ players: [player(B, { fids: [9] })] }));
    expect(byAccount(rows, B).accounts.farcaster).toEqual([9]);
  });

  it("counts email reminders only for a confirmed email", () => {
    const b = byAccount(buildReachRows(inputs({ profiles: [{ address: B, xUsername: null, emailConfirmed: false, emailReminders: true }] })), B);
    expect([b.accounts.email, b.channels.email]).toEqual([false, false]);
  });
});

describe("a read that failed is unknown, never no", () => {
  it("says null for each unread source", () => {
    const b = byAccount(
      buildReachRows(
        inputs({ profiles: null, pushBrowsers: null, telegram: null, prefs: null, addedFids: null, coinbase: null, farcaster: { fidsOf: new Map(), answered: false } }),
      ),
      B,
    );
    expect(b.accounts).toEqual({ farcaster: null, x: null, email: null, telegram: null, coinbase: null });
    expect(b.channels).toEqual({ farcasterApp: null, browsers: null, email: null, telegram: null });
    expect([b.kinds, b.emailCadence]).toEqual([null, null]);
    // Failed choices must not read as "all off", nor a player with nothing.
    expect(hasAnything(b)).toBe(true);
  });

  it("still says yes to a Farcaster reach Neynar half-answered, and unknown to a no", () => {
    const half = { fidsOf: new Map([[A2, [42]]]), answered: false };
    const rows = buildReachRows(inputs({ farcaster: half }));
    expect(byAccount(rows, A).channels.farcasterApp).toBe(true);
    expect(byAccount(rows, B).channels.farcasterApp).toBeNull();
    expect(byAccount(rows, B).accounts.farcaster).toBeNull();
  });

  it("reads a missing choices table (an empty list) as everyone on the defaults", () => {
    const b = byAccount(buildReachRows(inputs({ prefs: [] })), A);
    expect(b.changed).toEqual([]);
    expect(b.kinds).toMatchObject({ daily: true, payday: false });
  });
});

describe("reachSummary", () => {
  it("counts players, the team's left out", () => {
    const s = reachSummary(buildReachRows(inputs()));
    expect(s.players).toBe(2);
    expect(s.connected).toBe(1);
    expect(s.accounts).toEqual({ farcaster: 1, x: 1, email: 1, telegram: 1, coinbase: 1, wallets: 1 });
    expect(s.channels).toEqual({ farcasterApp: 1, browsers: 1, email: 1, telegram: 1, any: 1, weekly: 1 });
    expect(s.kinds!.daily).toEqual({ getting: 1, changed: 1 });
    expect(s.kinds!.payday).toEqual({ getting: 1, changed: 1 });
    expect(s.kinds!.hunger).toEqual({ getting: 2, changed: 0 });
  });

  it("counts the weekly email only where email reaches the player, as the table shows it (Bugbot on #332)", () => {
    // B chose the weekly email but has no confirmed email: email can't reach B, weekly or not.
    const prefs = [...inputs().prefs!, { account: B, kinds: {}, emailCadence: "weekly" }];
    expect(reachSummary(buildReachRows(inputs({ prefs }))).channels.weekly).toBe(1);
    // Unread email is unknown; a known "no email" is a no whatever the cadence.
    expect(reachSummary(buildReachRows(inputs({ prefs, profiles: null }))).channels.weekly).toBeNull();
  });

  it("leaves a count unknown when a player's answer is", () => {
    const s = reachSummary(buildReachRows(inputs({ coinbase: null, prefs: null })));
    expect(s.accounts.coinbase).toBeNull();
    expect(s.channels.weekly).toBeNull();
    expect(s.kinds).toBeNull();
    expect(s.accounts.x).toBe(1);
  });
});

describe("what a row may carry", () => {
  it("carries no email address, push endpoint, or Telegram account, whatever the inputs hold", () => {
    const json = JSON.stringify(
      buildReachRows(
        inputs({
          profiles: [{ address: A, xUsername: null, emailConfirmed: true, emailReminders: true, email: "alice@example.com" } as never],
          telegram: Object.assign(new Set([A]), { chatId: 123456789 }),
        }),
      ),
    );
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("123456789");
    expect(json).not.toMatch(/endpoint|p256dh|chatId/);
  });

  it("names every reminder kind in the console", () => {
    expect(Object.keys(KIND_SHORT).sort()).toEqual([...REMINDER_KINDS].sort());
  });
});

describe("the two tables agree about who a player is", () => {
  // A3 is linked into A's account but left no trace; C's account wallet C was never seen, only C2.
  const A3 = "0xaaaa000000000000000000000000000000000003";
  const C = "0xcccc000000000000000000000000000000000001";
  const C2 = "0xcccc000000000000000000000000000000000002";
  const T0 = Date.UTC(2026, 10, 26, 7);
  const accountOf = (a: string) => (a === A2 || a === A3 ? A : a === C2 ? C : a);
  const walletsOf = (account: string) => (account === A ? [A, A2, A3] : account === C ? [C, C2] : [account]);

  it("lists the same accounts, names, wallets, and team marks", () => {
    const rows = buildPlayerRows({
      operators: new Set(),
      contracts: new Set(),
      sightings: [
        { address: A, firstSeenAt: T0, lastSeenAt: T0, daysSeen: 1, firstVia: "web", lastVia: "web", fid: null },
        { address: A2, firstSeenAt: T0 + 1000, lastSeenAt: T0 + 1000, daysSeen: 1, firstVia: "web", lastVia: "web", fid: 205525 },
        { address: C2, firstSeenAt: T0, lastSeenAt: T0, daysSeen: 1, firstVia: "farcaster", lastVia: "farcaster", fid: null },
      ],
      chain: new Map([[B, emptyActivity(T0)]]),
      holdings: { letters: {}, words: [] },
      profiles: [],
      pushBrowsers: new Map(),
      listings: new Map(),
      accountOf,
      // Only the linked wallet carries the name: both tables must still show it for the player.
      faces: { [A2]: { username: "psr", pfpUrl: null }, [C2]: { username: "cee", pfpUrl: null } },
    });
    const players = groupPlayers(rows, walletsOf);
    const reach = buildReachRows(inputs({ players }));
    const view = (xs: { account?: string; address?: string; name: string | null; operator: boolean }[], wallets: (x: never) => string[]) =>
      xs.map((x) => ({ account: x.account ?? x.address, name: x.name, operator: x.operator, wallets: wallets(x as never) })).sort((a, b) => a.account!.localeCompare(b.account!));
    const main = view(players, (p: (typeof players)[number]) => p.wallets.map((w) => w.address));
    const second = view(reach, (r: (typeof reach)[number]) => r.wallets);
    expect(second).toEqual(main);
    expect(main.find((m) => m.account === A)).toEqual({ account: A, name: "psr", operator: false, wallets: [A, A2, A3] });
    expect(main.find((m) => m.account === C)).toEqual({ account: C, name: "cee", operator: false, wallets: [C, C2] });
  });
});
